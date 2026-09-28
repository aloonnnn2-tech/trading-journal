import { formatMoney } from "@/lib/format/money";
import { MIN_SEGMENT_TRADES, MIN_SEGMENT_WITH_R, summariseSegment } from "@/lib/segments/engine";
import { formatDuration } from "@/lib/trades/panel";
import type { SummaryTrade } from "@/lib/trades/queries";

// The summary strip above the trade table (Phase 4B of docs/design-audit.md):
// six figures over every closed trade matching the list's filters.
//
// Every statistic comes from the stats engine (summariseSegment), per the
// spec's one-engine rule. What lives here is only the presentation: the
// minimums, and the reason shown in place of a figure that can't be given.
// **A figure that can't be computed is "—" with a reason, never 0** -- a 0%
// win rate over two trades reads as a verdict, and it isn't one.
//
// The minimums are the engine's own (Alon, 2026-09-28): MIN_SEGMENT_TRADES
// closed trades for win rate, profit factor and average hold, and
// MIN_SEGMENT_WITH_R trades carrying an R multiple for expectancy. Net P/L
// and the count are exact from the first trade. Formats match /analytics, so
// with no filters the two pages can be read against each other.

export interface SummaryFigure {
  key: "netPL" | "winRate" | "profitFactor" | "avgHold" | "trades" | "expectancy";
  label: string;
  /** Null when it can't be given; `reason` says why. */
  value: string | null;
  /** Set when value is null. */
  reason?: string;
  /** For colouring net P/L. */
  tone?: "profit" | "loss";
}

/** Expectancy as /analytics shows it ("0.14R", no plus sign), but with the
 *  U+2212 minus formatMoney uses, so "−0.11R" sits right beside "−$1,360.21". */
function formatR(value: number): string {
  const body = Math.abs(value).toFixed(2);
  return `${value < 0 && Number(body) !== 0 ? "−" : ""}${body}R`;
}

export function buildSummaryFigures(trades: SummaryTrade[]): SummaryFigure[] {
  const stats = summariseSegment(trades);
  const n = stats.trades;
  const none = "No closed trades match these filters.";
  const tooFew = (have: number) =>
    n === 0 ? none : `Needs at least ${MIN_SEGMENT_TRADES} closed trades; this filter has ${have}.`;
  const enough = n >= MIN_SEGMENT_TRADES;

  const netPL: SummaryFigure =
    n === 0
      ? { key: "netPL", label: "Net P/L", value: null, reason: none }
      : {
          key: "netPL",
          label: "Net P/L",
          value: formatMoney(stats.totalPL, { sign: "always" }),
          tone: stats.totalPL > 0 ? "profit" : stats.totalPL < 0 ? "loss" : undefined,
        };

  const winRate: SummaryFigure = enough && stats.winRate !== null
    ? { key: "winRate", label: "Win rate", value: `${(stats.winRate * 100).toFixed(0)}%` }
    : { key: "winRate", label: "Win rate", value: null, reason: tooFew(n) };

  let profitFactor: SummaryFigure;
  if (!enough) {
    profitFactor = { key: "profitFactor", label: "Profit factor", value: null, reason: tooFew(n) };
  } else if (stats.profitFactor === null) {
    // Gross loss of zero: the ratio is undefined, not large.
    profitFactor = {
      key: "profitFactor",
      label: "Profit factor",
      value: null,
      reason: "No losing trades in this filter, so there's no loss to divide by.",
    };
  } else {
    profitFactor = { key: "profitFactor", label: "Profit factor", value: stats.profitFactor.toFixed(2) };
  }

  const avgHold: SummaryFigure =
    stats.withHold >= MIN_SEGMENT_TRADES && stats.avgHoldingDays !== null
      ? { key: "avgHold", label: "Avg hold", value: formatDuration(stats.avgHoldingDays * 86_400_000) }
      : {
          key: "avgHold",
          label: "Avg hold",
          value: null,
          reason:
            n === 0
              ? none
              : `Needs at least ${MIN_SEGMENT_TRADES} closed trades with entry and exit dates; this filter has ${stats.withHold}.`,
        };

  // A count is exact at any size, including 0.
  const count: SummaryFigure = { key: "trades", label: "Trades", value: `${n.toLocaleString("en-US")} closed` };

  const expectancy: SummaryFigure =
    stats.withR >= MIN_SEGMENT_WITH_R && stats.expectancy !== null
      ? { key: "expectancy", label: "Expectancy", value: formatR(stats.expectancy) }
      : {
          key: "expectancy",
          label: "Expectancy",
          value: null,
          reason:
            n === 0
              ? none
              : `Needs at least ${MIN_SEGMENT_WITH_R} closed trades with an R multiple; this filter has ${stats.withR}.`,
        };

  return [netPL, winRate, profitFactor, avgHold, count, expectancy];
}
