// One way to cut the journal into groups and score them.
//
// **Why this exists.** Four modules had grown their own version of "group the
// trades, count wins, average the R": lib/insights (win-rate deviation),
// lib/mistakes (with/without cohorts), ai-reviews/period-context (per strategy,
// ticker, day) and lib/emotions (per emotion tag). They agree today. Nothing
// made them agree, and the codebase's own rule is that there must not be two
// definitions of win rate or expectancy.
//
// So the arithmetic lives here once, and callers supply only the part that is
// genuinely theirs: which dimension to cut by, and what to do with the result.
//
// Every definition below is the one already used elsewhere in the app:
//   - a WIN is dollar_pl > 0 (net of commission -- see lib/trades/compute.ts)
//   - EXPECTANCY is rSum / rCount over trades carrying an R multiple, which is
//     exactly getAnalyticsSummary's `expectancy`, and is in R, not dollars

/** The minimum a segment needs before it is allowed to be a finding.
 *  Matches lib/insights' MIN_SAMPLE_SIZE so the two agree on "too small". */
export const MIN_SEGMENT_TRADES = 5;

/** The minimum R-bearing trades before a segment's expectancy is reported.
 *  Separate from the trade count on purpose: twenty trades of which two carry
 *  an R multiple is a two-trade average wearing a twenty. */
export const MIN_SEGMENT_WITH_R = 5;

/** The least a trade must expose to be counted. */
export interface SegmentableTrade {
  id: string;
  dollar_pl: number | null;
  r_multiple: number | null;
}

export interface SegmentStats {
  trades: number;
  wins: number;
  /** Null only when the segment is empty. */
  winRate: number | null;
  /** Average R per trade. Null when no trade in the segment carries one. */
  expectancy: number | null;
  /** How many trades the expectancy was computed from. */
  withR: number;
  totalR: number;
  totalPL: number;
  /** Losing trades, i.e. net P&L below zero. Break-even is neither. */
  losses: number;
  /** Average winning trade, in dollars. Null with no winners. */
  avgWin: number | null;
  /** Average losing trade as a POSITIVE number, matching
   *  getAnalyticsSummary's `avgLoss`. Null with no losers. */
  avgLoss: number | null;
  /** Gross win over gross loss. Null when nothing was lost -- a profit factor
   *  with a zero denominator is infinity, not a large number. */
  profitFactor: number | null;
  /**
   * Deepest peak-to-trough fall in this segment's own running P&L, as a
   * negative number (0 when it never fell).
   *
   * **Order-dependent**: it walks the trades as given, so callers must pass
   * them chronologically or this measures nothing. Every caller in this app
   * orders by exit_date.
   *
   * It is the drawdown of THIS SEGMENT's contribution, not of the account --
   * a strategy's -$400 drawdown says nothing about what the balance did while
   * other strategies were running. Label it accordingly.
   */
  maxDrawdown: number;
}

/**
 * One way of cutting the journal.
 *
 * `valuesOf` returns every label a trade belongs to in this dimension --
 * usually one, but a trade can carry two strategies or three emotion tags, and
 * it legitimately counts in both. Returning an empty array means the dimension
 * does not apply to that trade, which is different from a label of "none": a
 * trade with no strategy tagged should not create a phantom "no strategy"
 * cohort unless the dimension deliberately says so.
 */
export interface Dimension<T extends SegmentableTrade> {
  id: string;
  /** Shown as the group heading, e.g. "Strategy". */
  label: string;
  valuesOf: (trade: T) => string[];
  /**
   * A /trades URL showing exactly this segment's trades, or null when no
   * filter can express it. Null is honest: `direction`, day-of-week and
   * holding period have no server-side filter, and a link that silently showed
   * the wrong trades would be worse than no link.
   */
  drillDown?: (value: string, trades: T[]) => string | null;
}

export interface Segment<T extends SegmentableTrade = SegmentableTrade> {
  dimensionId: string;
  dimensionLabel: string;
  /** The segment's own name, e.g. "Breakout" or "Monday". */
  value: string;
  stats: SegmentStats;
  trades: T[];
  drillDownUrl: string | null;
}

export function summariseSegment(trades: SegmentableTrade[]): SegmentStats {
  const withR = trades.filter((t) => t.r_multiple != null);
  const totalR = withR.reduce((sum, t) => sum + (t.r_multiple ?? 0), 0);

  // Every definition below is getAnalyticsSummary's, so a strategy's profit
  // factor here and the account's there mean the same thing.
  let wins = 0;
  let losses = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const trade of trades) {
    const pl = trade.dollar_pl ?? 0;
    if (pl > 0) {
      wins += 1;
      grossWin += pl;
    } else if (pl < 0) {
      // Break-even counts as neither, matching every other win rate here.
      losses += 1;
      grossLoss += Math.abs(pl);
    }

    equity += pl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity - peak);
  }

  return {
    trades: trades.length,
    wins,
    winRate: trades.length > 0 ? wins / trades.length : null,
    expectancy: withR.length > 0 ? totalR / withR.length : null,
    withR: withR.length,
    totalR,
    totalPL: trades.reduce((sum, t) => sum + (t.dollar_pl ?? 0), 0),
    losses,
    avgWin: wins > 0 ? grossWin / wins : null,
    avgLoss: losses > 0 ? grossLoss / losses : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    maxDrawdown,
  };
}

/** Cuts `trades` by one dimension. Segments come back largest first. */
export function buildSegments<T extends SegmentableTrade>(
  trades: T[],
  dimension: Dimension<T>,
): Segment<T>[] {
  const grouped = new Map<string, T[]>();

  for (const trade of trades) {
    for (const value of dimension.valuesOf(trade)) {
      // A trade appearing twice under the same label (two strategies with the
      // same name, a duplicated tag) must still count once.
      const bucket = grouped.get(value) ?? [];
      if (!bucket.includes(trade)) bucket.push(trade);
      grouped.set(value, bucket);
    }
  }

  return Array.from(grouped.entries())
    .map(([value, segmentTrades]) => ({
      dimensionId: dimension.id,
      dimensionLabel: dimension.label,
      value,
      stats: summariseSegment(segmentTrades),
      trades: segmentTrades,
      drillDownUrl: dimension.drillDown?.(value, segmentTrades) ?? null,
    }))
    .sort((a, b) => b.stats.trades - a.stats.trades);
}

export function buildAllSegments<T extends SegmentableTrade>(
  trades: T[],
  dimensions: Dimension<T>[],
): Segment<T>[] {
  return dimensions.flatMap((dimension) => buildSegments(trades, dimension));
}

export interface RankOptions {
  minTrades?: number;
  minWithR?: number;
}

export interface RankedSegments<T extends SegmentableTrade> {
  /** Best expectancy first. */
  edges: Segment<T>[];
  /** Worst expectancy first. */
  leaks: Segment<T>[];
  /** Every segment that cleared the sample floor, best first. */
  ranked: Segment<T>[];
  /** Segments excluded for being too small -- counted so the UI can say so
   *  rather than silently showing a shorter list than the data suggests. */
  excludedForSample: number;
}

/**
 * Ranks segments by expectancy.
 *
 * **Expectancy, not win rate**, which is the whole point of this over the
 * existing deviation view: a setup winning 70% of the time for +0.2R is worse
 * than one winning 40% for +1.5R, and a win-rate ranking calls the first one
 * the better edge.
 *
 * Segments below the sample floor are removed rather than ranked low. A
 * three-trade segment at +4R is not a weak edge, it is not an edge -- and
 * leaving it in the list at the top is exactly how this feature would start
 * producing confident nonsense.
 */
export function rankSegments<T extends SegmentableTrade>(
  segments: Segment<T>[],
  options: RankOptions = {},
): RankedSegments<T> {
  const minTrades = options.minTrades ?? MIN_SEGMENT_TRADES;
  const minWithR = options.minWithR ?? MIN_SEGMENT_WITH_R;

  const eligible = segments.filter(
    (s) => s.stats.trades >= minTrades && s.stats.withR >= minWithR && s.stats.expectancy !== null,
  );

  const ranked = [...eligible].sort((a, b) => {
    const gap = (b.stats.expectancy ?? 0) - (a.stats.expectancy ?? 0);
    // Ties broken by sample size: between two segments at the same expectancy,
    // the one resting on more trades is the more trustworthy finding.
    return gap !== 0 ? gap : b.stats.trades - a.stats.trades;
  });

  return {
    ranked,
    edges: ranked,
    leaks: [...ranked].reverse(),
    excludedForSample: segments.length - eligible.length,
  };
}
