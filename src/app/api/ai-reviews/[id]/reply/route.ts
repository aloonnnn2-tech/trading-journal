import { logError } from "@/lib/observability/scrub";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePaidUser } from "@/lib/ai-keys/guard";
import { preflightProviderCall } from "@/lib/ai-keys/preflight";
import { providerErrorResponse } from "@/lib/ai-keys/provider-error-response";
import { getProvider } from "@/lib/ai-keys/providers";
import { withRetiredModelRetry } from "@/lib/ai-keys/repick-model";
import { rateLimit } from "@/lib/rate-limit";
import { enforceDailyCap } from "@/lib/rate-limits/daily";
import { getTrade } from "@/lib/trades/queries";
import { getUserSettings } from "@/lib/settings/queries";
import { generateStructured, StructuredOutputError } from "@/lib/ai-reviews/parse";
import { buildTradeReviewContext } from "@/lib/ai-reviews/trade-context";
import type { TradeReviewContent } from "@/lib/ai-reviews/schema";
import {
  DEBATE_SCHEMA_HINT,
  DEBATE_SYSTEM_PROMPT,
  MAX_MESSAGE_CHARS,
  MAX_THREAD_MESSAGES,
  appendExchange,
  buildDebatePrompt,
  debateReplySchema,
  getReviewThread,
  revisionOf,
  saveRevision,
} from "@/lib/ai-reviews/thread";

// One message in the debate under a trade review: the trader explains or
// pushes back, the model judges the reasoning, and -- if it changed its mind
// -- the review is revised as a new version (src/lib/ai-reviews/thread.ts).
//
// Same gates as generating a review: paid plan, the review rate limit and
// daily cap, the provider consent for reviews. The trade itself is never
// written to.

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

// A reply can carry a whole revised review, so it gets the platform's full
// synchronous budget (Netlify: 60 s) rather than the review route's 26.
export const maxDuration = 60;
const PROVIDER_BUDGET_MS = 50_000;
/** Room for a reply plus a complete revised review, and a reasoning model's thinking. */
const MAX_TOKENS = 3_500;

const bodySchema = z.object({
  keyId: z.uuid(),
  message: z
    .string()
    .trim()
    .min(1, "Write something first.")
    .max(MAX_MESSAGE_CHARS, `Keep it under ${MAX_MESSAGE_CHARS} characters.`)
    .refine((s) => !s.includes("\u0000"), "That message contains an invalid character."),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now();
  const { id } = await params;

  const gate = await requirePaidUser();
  if (!gate.ok) return gate.response;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const limit = await rateLimit(`ai-review:${gate.userId}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many in a row — give it a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  const daily = await enforceDailyCap("ai-review", gate.userId);
  if (daily) return daily;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  // RLS: someone else's review id doesn't resolve.
  const { data: reviewRow, error: reviewError } = await gate.supabase
    .from("ai_reviews")
    .select("id, review_type, trade_id, provider, model, content, created_at")
    .eq("id", id)
    .maybeSingle();
  if (reviewError) throw reviewError;
  const review = reviewRow as {
    id: string;
    review_type: string;
    trade_id: string | null;
    provider: string;
    model: string;
    content: TradeReviewContent;
    created_at: string;
  } | null;
  if (!review || review.review_type !== "trade" || !review.trade_id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const thread = await getReviewThread(gate.supabase, review.id);
  if (!thread.available) {
    return NextResponse.json(
      { error: "Discussing reviews isn't set up on this server yet (a database migration is pending)." },
      { status: 503 },
    );
  }
  if (thread.messages.length + 2 > MAX_THREAD_MESSAGES) {
    return NextResponse.json(
      { error: "This discussion is at its limit. Regenerate the review to start a fresh one." },
      { status: 409 },
    );
  }

  const trade = await getTrade(gate.supabase, review.trade_id);
  if (!trade) return NextResponse.json({ error: "That trade no longer exists." }, { status: 404 });

  // Same agreement as generating the review: the same trade data goes out.
  const ready = await preflightProviderCall(gate.supabase, parsed.data.keyId, gate.userId);
  if (!ready.ok) return ready.response;

  const settings = await getUserSettings(gate.supabase, gate.userId);
  const context = await buildTradeReviewContext(gate.supabase, trade, settings.timezone);
  const version = thread.versions.length > 0 ? thread.versions[thread.versions.length - 1].version : 1;
  const provider = getProvider(ready.provider);

  let reply;
  let usedModel = ready.model;
  try {
    reply = await withRetiredModelRetry(
      (model) => {
        usedModel = model;
        return generateStructured({
          provider,
          apiKey: ready.key,
          model,
          systemPrompt: DEBATE_SYSTEM_PROMPT,
          userPrompt: buildDebatePrompt({
            context,
            review: review.content,
            version,
            history: thread.messages,
            message: parsed.data.message,
          }),
          schema: debateReplySchema,
          schemaHint: DEBATE_SCHEMA_HINT,
          maxTokens: MAX_TOKENS,
          deadlineAt: startedAt + PROVIDER_BUDGET_MS,
          signal: request.signal,
        });
      },
      {
        supabase: gate.supabase,
        userId: gate.userId,
        keyId: parsed.data.keyId,
        providerName: ready.provider,
        provider,
        key: ready.key,
        model: ready.model,
        logPrefix: "ai-review-reply",
        deadlineAt: startedAt + PROVIDER_BUDGET_MS,
      },
    );
  } catch (err) {
    if (err instanceof StructuredOutputError) {
      logError(`[ai-review-reply] ${ready.provider} unusable output:`, err.detail);
      return NextResponse.json(
        { error: "The model's answer couldn't be read. Try again, or with a different provider." },
        { status: 502 },
      );
    }
    return providerErrorResponse(err, {
      supabase: gate.supabase,
      provider: ready.provider,
      keyId: parsed.data.keyId,
      logPrefix: "ai-review-reply",
      truncatedHint: "The model ran out of room before it finished. Try again, or use a provider with a larger answer budget.",
    });
  }

  // A revision only when it changed its mind AND sent the whole new review.
  //
  // seq and version numbers come from the read before the provider call, so
  // a second reply sent at the same moment (another tab, a retry) collides
  // on the unique indexes: said plainly as a 409, never a bare 500. The
  // version goes in first and carries its own "changed because", so even a
  // failure before the messages are written leaves the change explained.
  const revised = revisionOf(reply);
  let versions = thread.versions;
  let versionAfter: number | null = null;
  let added;
  try {
    if (revised) {
      const saved = await saveRevision(gate.supabase, gate.userId, review, versions, {
        content: revised,
        provider: ready.provider,
        model: usedModel,
        changedBecause: reply.changed_because,
      });
      versions = saved.versions;
      versionAfter = saved.version;
    }
    const startSeq = thread.messages.length > 0 ? thread.messages[thread.messages.length - 1].seq + 1 : 0;
    added = await appendExchange(gate.supabase, gate.userId, review.id, startSeq, parsed.data.message, {
      content: reply.reply,
      verdict: reply.verdict,
      versionAfter,
    });
  } catch (err) {
    if ((err as { code?: string } | null)?.code === "23505") {
      return NextResponse.json(
        { error: "Another reply to this review was saved at the same moment. Reload the page to see it." },
        { status: 409 },
      );
    }
    throw err;
  }

  return NextResponse.json({
    messages: [...thread.messages, ...added],
    versions,
    review: revised ? { content: revised, provider: ready.provider, model: usedModel } : null,
  });
}
