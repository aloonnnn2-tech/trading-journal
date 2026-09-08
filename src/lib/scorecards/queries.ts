import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeDimensions, fetchEdgeRows, type EdgeRow } from "@/lib/edge/queries";
import {
  buildAllSegments,
  MIN_SEGMENT_TRADES,
  rankSegments,
  summariseSegment,
  type Segment,
  type SegmentStats,
} from "@/lib/segments/engine";
import { listStrategies } from "@/lib/strategies/queries";
import type { Strategy } from "@/lib/strategies/types";

// A full scorecard per strategy.
//
// Almost nothing here is new arithmetic: the stats come from the shared
// segments engine, and the "best / worst conditions" sections reuse the SAME
// dimension definitions Find My Edge cuts by (lib/edge). A parallel set would
// eventually disagree with it about what a late exit or a risk band is, and
// then two pages would describe the same trade differently.

/** Trades needed on EACH side before a recent-vs-earlier split is shown.
 *  Below this it is two anecdotes with a date between them. */
const MIN_SPLIT_TRADES = MIN_SEGMENT_TRADES;

export interface StrategyScorecard {
  strategy: Pick<Strategy, "id" | "name" | "color">;
  overall: SegmentStats;
  /**
   * The strategy's trades halved chronologically. Null when either half is too
   * small -- most journals will see null here for a long time, and reporting
   * "recent performance" from three trades would be worse than reporting none.
   */
  trend: { recent: SegmentStats; earlier: SegmentStats } | null;
  /** Best and worst sub-segments within this strategy (day, risk band, exit
   *  behaviour...), only where they clear the sample floor. Frequently empty:
   *  a strategy's trades split five ways rarely leaves five in a cell. */
  bestCondition: Segment<EdgeRow> | null;
  worstCondition: Segment<EdgeRow> | null;
  /** Sub-segments dropped for being too small, so the UI can say why the
   *  conditions section is empty rather than leaving a blank. */
  conditionsExcluded: number;
  drillDownUrl: string;
}

export interface ScorecardReport {
  scorecards: StrategyScorecard[];
  /** Strategies with fewer than the floor, listed so they are visibly known
   *  about rather than silently missing. */
  belowFloor: { name: string; trades: number }[];
  tradesAnalysed: number;
}

function strategyIdsOf(row: EdgeRow): string[] {
  return row.trade_strategies.flatMap((link) => link.strategies).map((s) => s?.id).filter(Boolean);
}

export async function getScorecards(
  supabase: SupabaseClient,
  timezone: string | null,
): Promise<ScorecardReport> {
  const [rows, strategies] = await Promise.all([
    // Oldest first, which is what makes the engine's drawdown meaningful.
    fetchEdgeRows(supabase),
    listStrategies(supabase),
  ]);

  // Every dimension except the strategy itself -- cutting a strategy by
  // strategy would produce one segment containing everything.
  const conditionDimensions = edgeDimensions(timezone).filter((d) => d.id !== "strategy");

  const scorecards: StrategyScorecard[] = [];
  const belowFloor: { name: string; trades: number }[] = [];

  for (const strategy of strategies) {
    const trades = rows.filter((row) => strategyIdsOf(row).includes(strategy.id));

    if (trades.length < MIN_SEGMENT_TRADES) {
      belowFloor.push({ name: strategy.name, trades: trades.length });
      continue;
    }

    // Halved chronologically -- `rows` is already oldest-first.
    const midpoint = Math.floor(trades.length / 2);
    const earlier = trades.slice(0, midpoint);
    const recent = trades.slice(midpoint);
    const trend =
      earlier.length >= MIN_SPLIT_TRADES && recent.length >= MIN_SPLIT_TRADES
        ? { recent: summariseSegment(recent), earlier: summariseSegment(earlier) }
        : null;

    const conditions = rankSegments(buildAllSegments(trades, conditionDimensions));
    const best = conditions.edges[0] ?? null;
    // Guard against a single eligible sub-segment being reported as both the
    // best and the worst condition, which reads as a finding and is not one.
    const worst =
      conditions.leaks[0] && conditions.leaks[0] !== best ? conditions.leaks[0] : null;

    scorecards.push({
      strategy: { id: strategy.id, name: strategy.name, color: strategy.color },
      overall: summariseSegment(trades),
      trend,
      bestCondition: best,
      worstCondition: worst,
      conditionsExcluded: conditions.excludedForSample,
      drillDownUrl: `/trades?strategy=${encodeURIComponent(strategy.id)}`,
    });
  }

  return {
    scorecards: scorecards.sort((a, b) => b.overall.trades - a.overall.trades),
    belowFloor,
    tradesAnalysed: rows.length,
  };
}
