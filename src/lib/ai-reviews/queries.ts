import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
// Re-exported so existing importers keep working; the definition is shared
// with the plan-rules feature, which needs the same detection.
import { isMissingTableError } from "@/lib/supabase/errors";

export { isMissingTableError };
import type { AIProviderName } from "@/lib/ai-keys/types";
import type { PeriodReviewContent, TradeReviewContent } from "./schema";
import { resolvePeriod, type ResolvedPeriod } from "./period";
import type { StoredReview } from "./types";

// Reads and writes for `ai_reviews` (0032).
//
// All of it goes through the RLS-scoped client, so "ai_reviews owner access"
// already confines every statement to the signed-in user's own rows. Nothing
// here needs -- or should get -- the service-role client.

const COLUMNS =
  "id, review_type, trade_id, period_start, period_end, trades_analyzed, provider, model, content, source_updated_at, created_at";

/**
 * The saved review for one trade, or null when there isn't one.
 *
 * Returns null rather than throwing when 0032 hasn't been applied: the trade
 * page renders this alongside everything else, and a pending migration must
 * degrade to "no review yet" rather than taking the whole page down. The
 * generate route reports the missing table properly, which is where a user
 * can actually act on it.
 */
export async function getTradeReview(
  supabase: SupabaseClient,
  tradeId: string,
): Promise<StoredReview<TradeReviewContent> | null> {
  const { data, error } = await supabase
    .from("ai_reviews")
    .select(COLUMNS)
    .eq("trade_id", tradeId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  return (data as unknown as StoredReview<TradeReviewContent>) ?? null;
}

export async function saveTradeReview(
  supabase: SupabaseClient,
  userId: string,
  input: {
    tradeId: string;
    provider: AIProviderName;
    model: string;
    content: TradeReviewContent;
    sourceUpdatedAt: string | null;
  },
): Promise<StoredReview<TradeReviewContent>> {
  const { data, error } = await supabase
    .from("ai_reviews")
    .upsert(
      {
        user_id: userId,
        review_type: "trade",
        trade_id: input.tradeId,
        trades_analyzed: 1,
        provider: input.provider,
        model: input.model,
        content: input.content,
        source_updated_at: input.sourceUpdatedAt,
        // Regeneration must look freshly generated, so this is set explicitly
        // rather than left to the column default -- an upsert that updates an
        // existing row would otherwise keep the original row's created_at and
        // the card would claim a review written seconds ago is weeks old.
        created_at: new Date().toISOString(),
      },
      // Replaces rather than accumulates: see ai_reviews_one_per_trade in 0032.
      { onConflict: "user_id,trade_id" },
    )
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return data as unknown as StoredReview<TradeReviewContent>;
}

/**
 * Deletes a review. Returns false when nothing matched.
 *
 * RLS scopes the delete to the caller, so someone else's review id simply
 * matches no rows -- reported by the route as 404, not 403, for the same
 * reason as deleteApiKey: a 403 would confirm the id exists and belongs to
 * somebody, which is enough to enumerate valid ids.
 */
export async function deleteReview(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await supabase.from("ai_reviews").delete().eq("id", id).select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/**
 * Has the trade changed since its review was generated?
 *
 * Compared at read time rather than stored, because it is a question about
 * live data: a flag written at generation time would be correct only until
 * the next edit. Generating a review never writes to the trade, so no
 * tolerance is needed here -- any movement in `updated_at` is a real edit.
 *
 * Returns false when the review predates this column being populated. An
 * unknown answer is better shown as "not stale" than as a warning the user
 * can neither confirm nor clear.
 */
export function isTradeReviewStale(
  review: Pick<StoredReview, "source_updated_at">,
  trade: { updated_at: string },
): boolean {
  if (!review.source_updated_at) return false;
  const generatedAgainst = new Date(review.source_updated_at).getTime();
  const current = new Date(trade.updated_at).getTime();
  if (!Number.isFinite(generatedAgainst) || !Number.isFinite(current)) return false;
  return current > generatedAgainst;
}

// ---- Period reviews --------------------------------------------------------

/**
 * How many period reviews to keep per user.
 *
 * Unlike trade reviews -- capped at one per trade by a unique constraint --
 * period reviews accumulate: every week generates another, forever, and
 * regenerating the same week adds one more. Fifty is roughly a year of weekly
 * reviews, which is well past the point anyone scrolls back to, and it bounds
 * a table that would otherwise only ever grow.
 */
const MAX_PERIOD_REVIEWS = 50;

export async function listPeriodReviews(
  supabase: SupabaseClient,
): Promise<StoredReview<PeriodReviewContent>[]> {
  const { data, error } = await supabase
    .from("ai_reviews")
    .select(COLUMNS)
    .neq("review_type", "trade")
    .order("created_at", { ascending: false })
    .limit(MAX_PERIOD_REVIEWS);

  if (error) {
    // Same reasoning as getTradeReview: a pending migration degrades to "no
    // history yet" rather than taking the page down.
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return (data ?? []) as unknown as StoredReview<PeriodReviewContent>[];
}

export async function savePeriodReview(
  supabase: SupabaseClient,
  userId: string,
  input: {
    period: ResolvedPeriod;
    provider: AIProviderName;
    model: string;
    content: PeriodReviewContent;
    tradesAnalyzed: number;
    sourceUpdatedAt: string | null;
  },
): Promise<StoredReview<PeriodReviewContent>> {
  const { data, error } = await supabase
    .from("ai_reviews")
    // A plain insert, not an upsert: period reviews KEEP history. Comparing
    // this week's review with last week's is the point of having them, and
    // re-running the same week after fixing a mis-logged trade should leave
    // both versions visible rather than silently replacing the old one.
    .insert({
      user_id: userId,
      review_type: input.period.kind,
      trade_id: null,
      period_start: input.period.startDate,
      period_end: input.period.endDate,
      trades_analyzed: input.tradesAnalyzed,
      provider: input.provider,
      model: input.model,
      content: input.content,
      source_updated_at: input.sourceUpdatedAt,
    })
    .select(COLUMNS)
    .single();

  if (error) throw error;

  // Best-effort: a retention failure must not turn a review the user just
  // paid tokens for into an error. The row is already saved by this point.
  try {
    await prunePeriodReviews(supabase);
  } catch (err) {
    console.error("[ai-review] pruning old period reviews failed:", err);
  }

  return data as unknown as StoredReview<PeriodReviewContent>;
}

/** Drops everything past MAX_PERIOD_REVIEWS, oldest first. RLS scopes this to
 *  the caller, so it can only ever delete the user's own rows. */
async function prunePeriodReviews(supabase: SupabaseClient): Promise<void> {
  const { data, error } = await supabase
    .from("ai_reviews")
    .select("id")
    .neq("review_type", "trade")
    .order("created_at", { ascending: false })
    .range(MAX_PERIOD_REVIEWS, MAX_PERIOD_REVIEWS + 999);

  if (error) throw error;
  const ids = (data ?? []).map((row) => (row as { id: string }).id);
  if (ids.length === 0) return;

  const { error: deleteError } = await supabase.from("ai_reviews").delete().in("id", ids);
  if (deleteError) throw deleteError;
}

/**
 * Which of these period reviews no longer match the data underneath them.
 *
 * Harder than the single-trade case, because a period can change in two ways
 * that look nothing alike: a trade inside it was edited, or a trade was added
 * to (or removed from) the window entirely. Checking only `updated_at` would
 * miss a deletion; checking only the count would miss an edit. Both are
 * compared against what was recorded at generation time.
 *
 * Batched deliberately: ONE query fetches the two columns needed for every
 * closed trade, and each review's window is then counted in memory. The
 * obvious alternative -- a count query per review -- is fifty round trips to
 * render a history list, which is the kind of thing that looks fine with
 * three reviews and makes the page unusable with fifty.
 */
export async function stalePeriodReviewIds(
  supabase: SupabaseClient,
  reviews: StoredReview<unknown>[],
  timezone: string | null,
): Promise<string[]> {
  if (reviews.length === 0) return [];

  const rows = await fetchAllRows<{ exit_date: string; updated_at: string }>((from, to) =>
    supabase
      .from("trades")
      .select("exit_date, updated_at")
      .eq("status", "closed")
      .neq("mode", "investment")
      .not("exit_date", "is", null)
      .order("exit_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );

  // Parsed to epoch milliseconds once, rather than compared as strings.
  // PostgREST returns a timestamptz as "...+00:00" while startOfLocalDayIso
  // produces "...Z" -- lexicographically those two spellings of the same
  // instant do not compare correctly, so a trade sitting exactly on a period
  // boundary would fall on the wrong side of it.
  const parsed = rows.map((row) => ({
    exit: new Date(row.exit_date).getTime(),
    updated: new Date(row.updated_at).getTime(),
  }));

  const stale: string[] = [];

  for (const review of reviews) {
    if (!review.period_start || !review.period_end) continue;

    // Re-resolved rather than stored: the window is a pair of local calendar
    // days, and the instants they map to depend on the timezone in force now.
    const period = resolvePeriod("custom", timezone, new Date(), {
      startDate: review.period_start,
      endDate: review.period_end,
    });
    if (!period) continue;

    const startMs = new Date(period.startIso).getTime();
    const endMs = new Date(period.endIso).getTime();

    let count = 0;
    let newest = 0;
    for (const row of parsed) {
      // Half-open, matching how the review's own query selected these trades.
      if (row.exit < startMs || row.exit >= endMs) continue;
      count += 1;
      if (row.updated > newest) newest = row.updated;
    }

    if (count !== review.trades_analyzed) {
      stale.push(review.id);
      continue;
    }
    if (!review.source_updated_at || newest === 0) continue;
    if (newest > new Date(review.source_updated_at).getTime()) stale.push(review.id);
  }

  return stale;
}
