import type { SupabaseClient } from "@supabase/supabase-js";
import { getAnalyticsSummary, type AnalyticsSummary } from "@/lib/analytics/queries";
import { edgeDimensions, fetchEdgeRows, type EdgeRow } from "@/lib/edge/queries";
import { buildMistakeTrades } from "@/lib/mistakes/queries";
import { buildRiskReport, type RiskTrade } from "@/lib/risk/analyze";
import { buildSegments, rankSegments, type Segment } from "@/lib/segments/engine";
import { localDateParts } from "@/lib/dates/local-day";
import { resolvePeriod, type ResolvedPeriod } from "@/lib/ai-reviews/period";

// The month-end report: everything the app already knows, laid out as a
// document.
//
// **Nothing here computes a new statistic.** Every figure comes from a module
// that already owns it -- getAnalyticsSummary for the headline, the segments
// engine for the strategy ranking, the mistake tracker for the biggest
// mistake, the risk module for sizing. The brief is explicit that the numbers
// must come from the application's existing calculations and that no AI is
// responsible for arithmetic; this file is assembly, not measurement.
//
// That is also what distinguishes it from the AI Period Review, which reads
// the same journal and writes prose about it. This one needs no API key and
// states rather than interprets.

export const REPORT_PRESETS = [
  "this_month",
  "last_month",
  "this_quarter",
  "this_year",
  "custom",
] as const;
export type ReportPreset = (typeof REPORT_PRESETS)[number];

export const PRESET_LABELS: Record<ReportPreset, string> = {
  this_month: "This month",
  last_month: "Last month",
  this_quarter: "This quarter",
  this_year: "This year",
  custom: "Custom range",
};

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Last day of a 0-indexed month. */
function lastDayOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Turns a preset into a concrete window, resolved through the same
 * `resolvePeriod` the AI reviews use -- so a report and a review covering
 * "last month" cover exactly the same trades, in the trader's own days.
 */
export function resolveReportPeriod(
  preset: ReportPreset,
  timezone: string | null,
  custom?: { startDate: string; endDate: string },
  now: Date = new Date(),
): ResolvedPeriod | null {
  if (preset === "custom") {
    return custom ? resolvePeriod("custom", timezone, now, custom) : null;
  }

  const { year, month, day } = localDateParts(now, timezone);

  if (preset === "this_month") {
    // Up to today, not to the end of the month: a report of a month still in
    // progress should not imply the remaining days were flat.
    return resolvePeriod("custom", timezone, now, {
      startDate: ymd(year, month, 1),
      endDate: ymd(year, month, day),
    });
  }
  if (preset === "last_month") {
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    return resolvePeriod("custom", timezone, now, {
      startDate: ymd(prevYear, prevMonth, 1),
      endDate: ymd(prevYear, prevMonth, lastDayOf(prevYear, prevMonth)),
    });
  }
  if (preset === "this_quarter") {
    return resolvePeriod("custom", timezone, now, {
      startDate: ymd(year, Math.floor(month / 3) * 3, 1),
      endDate: ymd(year, month, day),
    });
  }
  return resolvePeriod("custom", timezone, now, {
    startDate: ymd(year, 0, 1),
    endDate: ymd(year, month, day),
  });
}

export interface ReportTrade {
  id: string;
  ticker: string | null;
  exitDate: string;
  dollarPL: number;
  rMultiple: number | null;
}

export interface TradingReport {
  period: ResolvedPeriod;
  summary: AnalyticsSummary;
  /** Best and worst strategies by expectancy, or null when none clears the
   *  shared sample floor -- a one-trade strategy is not a best strategy. */
  bestStrategy: Segment<EdgeRow> | null;
  worstStrategy: Segment<EdgeRow> | null;
  /** The mistake carried by the most trades in the period. */
  biggestMistake: { label: string; trades: number } | null;
  bestTrade: ReportTrade | null;
  worstTrade: ReportTrade | null;
  risk: { median: number | null; max: number | null; recorded: number; outliers: number };
  tradesAnalysed: number;
  generatedAt: string;
}

export async function buildTradingReport(
  supabase: SupabaseClient,
  period: ResolvedPeriod,
  timezone: string | null,
): Promise<TradingReport> {
  const [summary, allRows, mistakeTrades] = await Promise.all([
    // Already range-aware, and the single owner of profit factor, expectancy,
    // drawdown and the streak rules.
    getAnalyticsSummary(supabase, timezone, {
      startIso: period.startIso,
      endIso: period.endIso,
    }),
    fetchEdgeRows(supabase),
    buildMistakeTrades(supabase).catch(() => []),
  ]);

  // Half-open, matching how every other period feature selects trades, so a
  // trade on the boundary appears in exactly one report.
  const inPeriod = allRows.filter(
    (row) => row.exit_date >= period.startIso && row.exit_date < period.endIso,
  );

  const strategyDimension = edgeDimensions(timezone).find((d) => d.id === "strategy")!;
  const ranked = rankSegments(buildSegments(inPeriod, strategyDimension));

  // Guard against one eligible strategy being reported as both best and
  // worst, which reads as a comparison and is not one.
  const bestStrategy = ranked.edges[0] ?? null;
  const worstStrategy =
    ranked.leaks[0] && ranked.leaks[0] !== bestStrategy ? ranked.leaks[0] : null;

  const periodIds = new Set(inPeriod.map((row) => row.id));
  const mistakeCounts = new Map<string, number>();
  for (const trade of mistakeTrades) {
    if (!periodIds.has(trade.id)) continue;
    // A trade carrying the same label from two sources counts once.
    for (const label of new Set(trade.mistakes.map((m) => m.label))) {
      mistakeCounts.set(label, (mistakeCounts.get(label) ?? 0) + 1);
    }
  }
  const topMistake = [...mistakeCounts.entries()].sort((a, b) => b[1] - a[1])[0];

  const toReportTrade = (row: EdgeRow): ReportTrade => ({
    id: row.id,
    ticker: row.ticker,
    exitDate: row.exit_date,
    dollarPL: row.dollar_pl ?? 0,
    rMultiple: row.r_multiple,
  });

  // Ranked by money, not R: "best trade" is the one that made the most, and R
  // is shown beside it. Ranking by R would crown a tiny position that happened
  // to have a tight stop.
  const withPL = inPeriod.filter((row) => row.dollar_pl != null);
  const sortedByPL = [...withPL].sort((a, b) => (b.dollar_pl ?? 0) - (a.dollar_pl ?? 0));

  const riskReport = buildRiskReport(inPeriod as unknown as RiskTrade[]);

  return {
    period,
    summary,
    bestStrategy,
    worstStrategy,
    biggestMistake: topMistake ? { label: topMistake[0], trades: topMistake[1] } : null,
    bestTrade: sortedByPL[0] ? toReportTrade(sortedByPL[0]) : null,
    worstTrade:
      sortedByPL.length > 1 ? toReportTrade(sortedByPL[sortedByPL.length - 1]) : null,
    risk: {
      median: riskReport.risk.median,
      max: riskReport.risk.max,
      recorded: riskReport.risk.n,
      outliers: riskReport.outliers.length,
    },
    tradesAnalysed: inPeriod.length,
    generatedAt: new Date().toISOString(),
  };
}
