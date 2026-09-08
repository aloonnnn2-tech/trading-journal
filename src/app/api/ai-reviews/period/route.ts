import { NextResponse } from "next/server";
import { requirePaidUser } from "@/lib/ai-keys/guard";
import { preflightProviderCall } from "@/lib/ai-keys/preflight";
import { providerErrorResponse } from "@/lib/ai-keys/provider-error-response";
import { getProvider } from "@/lib/ai-keys/providers";
import { rateLimit } from "@/lib/rate-limit";
import { getUserSettings } from "@/lib/settings/queries";
import { generateStructured, StructuredOutputError } from "@/lib/ai-reviews/parse";
import { isMissingTableError, savePeriodReview } from "@/lib/ai-reviews/queries";
import { periodReviewContentSchema, periodReviewSchema } from "@/lib/ai-reviews/schema";
import {
  resolveRequestedPeriod,
  type PeriodKind,
  PERIOD_KINDS,
} from "@/lib/ai-reviews/period";
import {
  buildPeriodContext,
  countTradesInPeriod,
  PERIOD_REVIEW_MAX_TOKENS,
  PERIOD_REVIEW_SCHEMA_HINT,
  PERIOD_REVIEW_SYSTEM_PROMPT,
} from "@/lib/ai-reviews/period-context";

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

export const maxDuration = 26;

/** Same budget and reasoning as the trade review route. */
const PROVIDER_BUDGET_MS = 22_000;

function isPeriodKind(value: string | null): value is PeriodKind {
  return value !== null && (PERIOD_KINDS as readonly string[]).includes(value);
}

/**
 * Resolves a period and counts what falls in it, WITHOUT calling a provider.
 *
 * This is what makes the "this review will analyse 47 trades — continue?"
 * confirmation honest and free. The count comes from the same filtered query
 * the review itself uses (see periodQuery), so the number the user agrees to
 * is the number the review actually covers, and an empty period can be
 * reported without spending a single token of their quota.
 */
export async function GET(request: Request) {
  const gate = await requirePaidUser();
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  if (!isPeriodKind(kind)) {
    return NextResponse.json({ error: "Unknown period type" }, { status: 400 });
  }

  const settings = await getUserSettings(gate.supabase, gate.userId);
  const period = resolveRequestedPeriod(kind, settings.timezone, new Date(), {
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
  });
  if (!period) {
    return NextResponse.json(
      { error: "Pick a valid start and end date — the start must not be after the end." },
      { status: 400 },
    );
  }

  const trades = await countTradesInPeriod(gate.supabase, period);
  return NextResponse.json({ period, trades });
}

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

  const parsed = periodReviewSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const settings = await getUserSettings(gate.supabase, gate.userId);

  const period = resolveRequestedPeriod(parsed.data.kind, settings.timezone, new Date(), {
    startDate: parsed.data.startDate,
    endDate: parsed.data.endDate,
  });
  if (!period) {
    return NextResponse.json(
      { error: "Pick a valid start and end date — the start must not be after the end." },
      { status: 400 },
    );
  }

  // Checked before the provider is touched at all. An empty period has
  // nothing to review, and finding that out should not cost the user tokens.
  const tradeCount = await countTradesInPeriod(gate.supabase, period);
  if (tradeCount === 0) {
    return NextResponse.json(
      {
        error: `No closed trades in ${period.label}. Pick a period you actually traded in — open positions aren't reviewed, because they have no realised result yet.`,
      },
      { status: 400 },
    );
  }

  const ready = await preflightProviderCall(gate.supabase, parsed.data.keyId, gate.userId);
  if (!ready.ok) return ready.response;

  const context = await buildPeriodContext(gate.supabase, period, settings.timezone);
  const provider = getProvider(ready.provider);

  let content;
  try {
    content = await generateStructured({
      provider,
      apiKey: ready.key,
      systemPrompt: PERIOD_REVIEW_SYSTEM_PROMPT,
      userPrompt: `${context.text}\n\nReview this period now. Reply with the JSON object only.`,
      schema: periodReviewContentSchema,
      schemaHint: PERIOD_REVIEW_SCHEMA_HINT,
      maxTokens: PERIOD_REVIEW_MAX_TOKENS,
      deadlineAt: startedAt + PROVIDER_BUDGET_MS,
    });
  } catch (err) {
    if (err instanceof StructuredOutputError) {
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
        "The model ran out of room before it finished the review. Try a shorter period, or a provider with a larger answer budget.",
    });
  }

  try {
    const review = await savePeriodReview(gate.supabase, gate.userId, {
      period,
      provider: ready.provider,
      model: provider.model,
      content,
      tradesAnalyzed: context.tradesAnalyzed,
      sourceUpdatedAt: context.sourceUpdatedAt,
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
