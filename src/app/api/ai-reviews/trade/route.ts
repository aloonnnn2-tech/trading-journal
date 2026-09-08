import { NextResponse } from "next/server";
import { requirePaidUser } from "@/lib/ai-keys/guard";
import { preflightProviderCall } from "@/lib/ai-keys/preflight";
import { providerErrorResponse } from "@/lib/ai-keys/provider-error-response";
import { getProvider } from "@/lib/ai-keys/providers";
import { rateLimit } from "@/lib/rate-limit";
import { getTrade } from "@/lib/trades/queries";
import { getUserSettings } from "@/lib/settings/queries";
import { generateStructured, StructuredOutputError } from "@/lib/ai-reviews/parse";
import { isMissingTableError, saveTradeReview } from "@/lib/ai-reviews/queries";
import { tradeReviewContentSchema, tradeReviewSchema } from "@/lib/ai-reviews/schema";
import {
  buildTradeReviewContext,
  TRADE_REVIEW_MAX_TOKENS,
  TRADE_REVIEW_SCHEMA_HINT,
  TRADE_REVIEW_SYSTEM_PROMPT,
} from "@/lib/ai-reviews/trade-context";

// Lower than the ask route's 15/min. A review is a heavier request -- several
// DB reads, an outbound call, and a possible repair call -- and unlike a
// question there is nothing to gain from firing them in quick succession:
// regenerating the same trade twice in a row produces two critiques of
// identical data.
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

// Same ceiling and same reason as the ask route: stay under the hosting
// platform's own limit so a slow provider surfaces as one of the explained
// errors below rather than the platform's generic timeout page.
export const maxDuration = 26;

/**
 * Wall-clock budget for the provider work, leaving room inside `maxDuration`
 * for the context queries before it and the save after it.
 *
 * Passed down to generateStructured, which spends it across the generate call
 * and (if there is anything left) one repair call. Without a shared deadline
 * the repair could start with two seconds left and be killed mid-flight,
 * turning a specific "the model didn't return usable JSON" into an
 * unexplained platform error.
 */
const PROVIDER_BUDGET_MS = 22_000;

export async function POST(request: Request) {
  const startedAt = Date.now();

  const gate = await requirePaidUser();
  if (!gate.ok) return gate.response;

  const limit = rateLimit(`ai-review:${gate.userId}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many reviews in a row — give it a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = tradeReviewSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  // RLS scopes this, so another user's trade id simply doesn't resolve.
  const trade = await getTrade(gate.supabase, parsed.data.tradeId);
  if (!trade) {
    return NextResponse.json({ error: "That trade isn't available." }, { status: 404 });
  }

  // A review judges execution end to end -- exit management, plan adherence,
  // realised R. On an open position half of that has not happened yet, so a
  // review of one would be a critique of decisions the trader has not made.
  if (trade.status !== "closed") {
    return NextResponse.json(
      { error: "Close this trade first — a review judges how it was managed all the way out." },
      { status: 400 },
    );
  }
  // Investment-mode positions carry no realised P&L anywhere in this app (see
  // the exclusion in getAnalyticsSummary), so there is nothing to score.
  if (trade.mode === "investment") {
    return NextResponse.json(
      { error: "Trade reviews cover trades, not investment-mode positions." },
      { status: 400 },
    );
  }

  // Encryption configured, key resolvable, provider consented to. Nothing
  // about this trade leaves the server before this passes.
  const ready = await preflightProviderCall(gate.supabase, parsed.data.keyId, gate.userId);
  if (!ready.ok) return ready.response;

  const settings = await getUserSettings(gate.supabase, gate.userId);
  const context = await buildTradeReviewContext(gate.supabase, trade, settings.timezone);

  const provider = getProvider(ready.provider);

  let content;
  try {
    content = await generateStructured({
      provider,
      apiKey: ready.key,
      systemPrompt: TRADE_REVIEW_SYSTEM_PROMPT,
      userPrompt: `${context}\n\nReview this trade now. Reply with the JSON object only.`,
      schema: tradeReviewContentSchema,
      schemaHint: TRADE_REVIEW_SCHEMA_HINT,
      maxTokens: TRADE_REVIEW_MAX_TOKENS,
      deadlineAt: startedAt + PROVIDER_BUDGET_MS,
    });
  } catch (err) {
    if (err instanceof StructuredOutputError) {
      // Logged, not returned: the detail quotes the model's reply, which was
      // written from this user's journal.
      console.error(`[ai-review] ${ready.provider} unusable output:`, err.detail);
      return NextResponse.json(
        {
          error:
            "The model replied with something this app couldn't read as a review. Try again — or a different provider, since some models follow a strict format better than others.",
        },
        { status: 502 },
      );
    }
    return providerErrorResponse(err, {
      supabase: gate.supabase,
      provider: ready.provider,
      keyId: parsed.data.keyId,
      logPrefix: "ai-review",
      truncatedHint:
        "The model ran out of room before it finished the review. Try again, or use a provider with a larger answer budget.",
    });
  }

  // Only ever an insert into ai_reviews -- the trade itself is never written
  // to on this path, which is what makes "your trade was not changed" true by
  // construction rather than by careful handling.
  try {
    const review = await saveTradeReview(gate.supabase, gate.userId, {
      tradeId: trade.id,
      provider: ready.provider,
      model: provider.model,
      content,
      // What the review was generated against. A later edit moves the trade's
      // updated_at past this, which is how the card knows it is out of date.
      sourceUpdatedAt: trade.updated_at,
    });
    return NextResponse.json({ review });
  } catch (err) {
    if (isMissingTableError(err)) {
      return NextResponse.json(
        {
          error:
            "AI reviews aren't fully set up on this server yet (a database migration is pending). Contact whoever deployed it.",
        },
        { status: 503 },
      );
    }
    throw err;
  }
}
