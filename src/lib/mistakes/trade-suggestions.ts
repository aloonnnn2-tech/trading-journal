import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import type { Trade } from "@/lib/trades/types";
import type { TradeAdjustments } from "@/lib/trades/adjustments";
import { detectMistakes, medianRiskPercent, type MistakeTrade } from "./analyze";
import { suggestionsFor, type Suggestion } from "./suggestions";

// Turning what the app already detects about ONE trade into something the
// trader can accept onto it.
//
// The mistake tracker (queries.ts) runs these same detectors across the whole
// journal, but what it produces lives only inside that page's statistics: it
// is not on the trade, not filterable on /trades, not in an export, and not
// visible when you open the trade itself. Accepting a suggestion promotes an
// observation into the trader's own Mistakes field, where it becomes ordinary
// journal data like any tag they typed.
//
// Nothing here writes. The suggestions are recomputed on every page load from
// data that already exists, which is also why they can never go stale.

/** The tag field seeded by migration 0034. Same key queries.ts reads, so an
 *  accepted suggestion is indistinguishable from a hand-typed tag. */
export const MISTAKE_FIELD_KEY = "trade_mistakes";

/** Set by migration 0037. Absent (not empty) until that is applied, which is
 *  why every read goes through `dismissedLabels` rather than touching the
 *  property directly. */
const DISMISSED_COLUMN = "dismissed_suggestions";

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Labels already on the trade's Mistakes field. */
export function taggedLabels(trade: Pick<Trade, "custom_fields">): string[] {
  return asStringArray(trade.custom_fields?.[MISTAKE_FIELD_KEY]);
}

/**
 * Labels the trader has turned down.
 *
 * Reads the column defensively because 0037 is applied by hand: before it runs
 * the property is simply absent, which must read as "none dismissed yet" and
 * not as a crash on the trade page.
 */
export function dismissedLabels(trade: Trade): string[] {
  return asStringArray((trade as unknown as Record<string, unknown>)[DISMISSED_COLUMN]);
}

/**
 * The trader's own median risk, over their closed trades.
 *
 * Its own query rather than a slice of buildMistakeTrades: the trade page
 * needs one number, and buildMistakeTrades reads every trade, every history
 * snapshot and every strategy rule in the journal to produce a full report.
 * One column across closed trades is the cheapest thing that gives the same
 * answer -- and it must be the same answer, because "oversized" has to mean
 * the same thing here as it does on the mistake tracker.
 */
async function fetchMedianRisk(supabase: SupabaseClient): Promise<number | null> {
  const rows = await fetchAllRows<{ risk_percent: number | null }>((from, to) =>
    supabase
      .from("trades")
      .select("risk_percent")
      .eq("status", "closed")
      .not("exit_date", "is", null)
      .neq("mode", "investment")
      .range(from, to),
  ).catch(() => []);

  return medianRiskPercent(rows);
}

/** The subset of a Trade the detectors actually read. */
function toMistakeTrade(trade: Trade): MistakeTrade {
  return {
    id: trade.id,
    ticker: trade.ticker,
    exit_date: trade.exit_date,
    dollar_pl: trade.dollar_pl,
    r_multiple: trade.r_multiple,
    risk_percent: trade.risk_percent,
    stop_loss: trade.stop_loss,
    take_profit: trade.take_profit,
    exit_price: trade.exit_price,
    direction: trade.direction,
    mistakes: [],
  };
}

/**
 * Suggested tags for one trade: detected, minus what is already tagged,
 * minus what has been turned down.
 *
 * @param adjustments What the edit history says about the stop and target.
 *   The caller already has it -- the trade page fetches that history for the
 *   timeline and the plan rules -- so it is passed in rather than re-read.
 *   Narrowed to the two flags actually read, so a caller (and a test) needs
 *   only those rather than a whole adjustment record.
 */
export async function getTradeSuggestions(
  supabase: SupabaseClient,
  trade: Trade,
  adjustments: Pick<TradeAdjustments, "stopMoved" | "targetMoved"> | null,
): Promise<Suggestion[]> {
  // Only closed trades. Half of what is detected here -- exiting short of the
  // target, the R that resulted -- has no meaning while a position is open,
  // and an investment-mode row carries no realised P&L anywhere in this app.
  if (trade.status !== "closed" || trade.mode === "investment") return [];

  const medianRisk = await fetchMedianRisk(supabase);

  const detected = detectMistakes({
    trade: toMistakeTrade(trade),
    stopMoved: adjustments?.stopMoved ?? null,
    targetMoved: adjustments?.targetMoved ?? null,
    medianRisk,
  });

  return suggestionsFor(detected, taggedLabels(trade), dismissedLabels(trade));
}
