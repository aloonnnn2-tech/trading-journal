import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/observability/log";

export interface ClosedMissingExitDate {
  count: number;
  /** The most recently created one, so the notice can link straight to it. */
  firstTradeId: string | null;
  firstTicker: string | null;
}

const NONE: ClosedMissingExitDate = { count: 0, firstTradeId: null, firstTicker: null };

/**
 * Closed trades with no exit date.
 *
 * Every stat that needs a day to land on -- win rate, the performance chart,
 * the calendar, all of Analytics -- leaves these out, while the dashboard's
 * "Closed trades" count includes them. The two then disagree on the same
 * screen ("Closed trades 1" beside "No closed trades yet"). This is what lets
 * the page say which trade is missing what, instead of showing both numbers
 * and no reason.
 *
 * Investment-mode trades are left out: they are not in those stats either way.
 * Never throws: a notice is not worth failing the dashboard over.
 */
export async function getClosedMissingExitDate(supabase: SupabaseClient): Promise<ClosedMissingExitDate> {
  const { data, count, error } = await supabase
    .from("trades")
    .select("id, ticker", { count: "exact" })
    .eq("status", "closed")
    .is("exit_date", null)
    .neq("mode", "investment")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    log.error("trades.missing_exit_date_failed", { error });
    return NONE;
  }

  const first = (data as { id: string; ticker: string | null }[] | null)?.[0];
  if (!first) return NONE;
  return { count: count ?? 1, firstTradeId: first.id, firstTicker: first.ticker || null };
}

/** The sentence the notice shows. Split out so the wording is tested once. */
export function missingExitDateMessage(missing: ClosedMissingExitDate): string | null {
  if (missing.count <= 0) return null;
  if (missing.count === 1) {
    const subject = missing.firstTicker ? `${missing.firstTicker} is closed but has` : "1 closed trade has";
    return `${subject} no exit date, so it is not in your win rate or charts yet.`;
  }
  return `${missing.count} closed trades have no exit date, so they are not in your win rate or charts yet.`;
}
