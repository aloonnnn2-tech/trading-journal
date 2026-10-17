import type { SupabaseClient } from "@supabase/supabase-js";
import { getAnalyticsSummary, type AnalyticsSummary } from "@/lib/analytics/queries";
import { getExcursionReport } from "@/lib/excursions/report";
import { computeStats } from "../tools/journal";
import { TradeStore } from "../tools/store";
import type { ToolContext } from "../tools/journal";

// The right answers for the Ask benchmark, computed from the journal by the
// functions the app's own pages use -- never typed in by hand, so the
// benchmark stays true for whatever journal it runs against.
//
// Analytics-page figures come from getAnalyticsSummary and the MAE/MFE panel's
// getExcursionReport, which is what makes the "no key" run meaningful: it
// checks Ask's tools reach the SAME numbers the screen shows. Breakdowns the
// pages have no single function for (by setup, weekday, hour, emotion) use
// compute_stats' own grouping.

export interface Group {
  group: string;
  trades: number;
  totalPL: number;
  winRate: number | null;
}

export interface BenchJournal {
  summary: AnalyticsSummary;
  excursions: { avgMaePercent: number | null; avgMfePercent: number | null; medianCapture: number | null };
  groups: Record<"strategy" | "day_of_week" | "hour_of_day" | "emotion_before", Group[]>;
  latestNvda: { dollar_pl: number | null; entry_price: number | null } | null;
}

/** Groups too small to mean anything are left out of best/worst questions. */
export const MIN_GROUP_TRADES = 3;

export async function loadBenchJournal(supabase: SupabaseClient, timezone: string | null): Promise<BenchJournal> {
  const store = new TradeStore(supabase, timezone);
  const ctx: ToolContext = { supabase, timezone, store, outputBudget: 1_000_000 };
  const groupsOf = async (group_by: keyof BenchJournal["groups"]) => {
    const out = (await computeStats(ctx, { filter: undefined, group_by })) as { groups?: Group[] };
    return (out.groups ?? []).filter((g) => g.trades >= MIN_GROUP_TRADES);
  };
  const [summary, excursions, strategy, day_of_week, hour_of_day, emotion_before, trades] = await Promise.all([
    getAnalyticsSummary(supabase, timezone),
    getExcursionReport(supabase),
    groupsOf("strategy"),
    groupsOf("day_of_week"),
    groupsOf("hour_of_day"),
    groupsOf("emotion_before"),
    store.trades(),
  ]);
  // The store lists newest first, the same order get_trade picks "the NVDA trade" by.
  const nvda = trades.find((t) => (t.ticker ?? "").toUpperCase() === "NVDA");
  return {
    summary,
    excursions: {
      avgMaePercent: excursions.overall.avgMaePercent,
      avgMfePercent: excursions.overall.avgMfePercent,
      medianCapture: excursions.overall.medianCapture,
    },
    groups: { strategy, day_of_week, hour_of_day, emotion_before },
    latestNvda: nvda ? { dollar_pl: nvda.dollar_pl, entry_price: nvda.entry_price } : null,
  };
}
