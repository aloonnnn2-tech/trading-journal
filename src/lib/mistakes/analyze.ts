import { exitedBeforeTarget } from "@/lib/trades/behaviour";

// Finding recurring mistakes, and saying what they cost -- carefully.
//
// **The comparison is the dangerous part of this feature.** "Trades where you
// moved your stop returned -0.08R against +0.51R elsewhere" is a true
// statement about two samples. "Moving your stop costs you 0.59R" is a causal
// claim the data does not support: the trader moves stops on trades that were
// already going against them, so the mistake and the loss share a cause. This
// module is built to make the first statement and refuse the second -- both
// sample sizes travel with every comparison, and a comparison is withheld
// entirely below the threshold rather than shown with a caveat nobody reads.
//
// Everything here is a pure function over rows the caller already fetched.

/** Both sides of a comparison need this many trades before it is shown.
 *  Matches MIN_SAMPLE_SIZE in lib/insights/queries.ts, so the two features
 *  agree on what counts as too small to talk about. */
export const MIN_COMPARISON_SAMPLE = 5;

/**
 * A trade risking more than this multiple of the trader's own median risk is
 * flagged as oversized.
 *
 * Defined against their own median rather than an absolute percentage: there
 * is no universal "too big", and a 2% risk is normal for one account and
 * reckless for another. 1.5x is the same threshold the AI period review
 * already uses, so the two features flag the same trades.
 */
export const OVERSIZE_MULTIPLE = 1.5;

export type MistakeSource = "detected" | "rule" | "tagged";

export interface MistakeTrade {
  id: string;
  ticker: string | null;
  exit_date: string | null;
  dollar_pl: number | null;
  r_multiple: number | null;
  risk_percent: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  exit_price: number | null;
  direction: string | null;
  /** Mistake labels attached to this trade, from every source. */
  mistakes: { label: string; source: MistakeSource }[];
}

export interface CohortStats {
  trades: number;
  wins: number;
  winRate: number | null;
  /** Average R per trade -- the SAME definition as getAnalyticsSummary's
   *  `expectancy` (rSum / rCount over trades that have an R multiple), so this
   *  page and the Analytics page cannot disagree. */
  expectancy: number | null;
  /** How many trades actually carried an R multiple, since expectancy is
   *  computed over those alone. */
  withR: number;
  totalPL: number;
}

export interface MistakeSummary {
  label: string;
  sources: MistakeSource[];
  /** Trades carrying this mistake. */
  withMistake: CohortStats;
  /** Every other closed trade. */
  withoutMistake: CohortStats;
  /**
   * Null when either side is too small to compare, which is the common case
   * early on. The UI shows the frequency regardless -- "you did this 12
   * times" needs no statistics -- and simply omits the comparison.
   */
  expectancyGap: number | null;
  /** Ids of the trades involved, so the user can drill into them. */
  tradeIds: string[];
}

export function summariseCohort(trades: MistakeTrade[]): CohortStats {
  const withR = trades.filter((t) => t.r_multiple != null);
  const rSum = withR.reduce((sum, t) => sum + (t.r_multiple ?? 0), 0);
  const wins = trades.filter((t) => (t.dollar_pl ?? 0) > 0).length;

  return {
    trades: trades.length,
    wins,
    winRate: trades.length > 0 ? wins / trades.length : null,
    expectancy: withR.length > 0 ? rSum / withR.length : null,
    withR: withR.length,
    totalPL: trades.reduce((sum, t) => sum + (t.dollar_pl ?? 0), 0),
  };
}

/**
 * Groups trades by mistake and compares each cohort against the rest.
 *
 * The "without" side is every OTHER closed trade, not "trades with no mistakes
 * at all". Comparing against a spotless subset would inflate every gap, since
 * the clean cohort shrinks as more mistakes are tracked -- and a trader who
 * logs mistakes diligently would appear to be getting worse.
 */
export function analyseMistakes(trades: MistakeTrade[]): MistakeSummary[] {
  const labels = new Map<string, { ids: Set<string>; sources: Set<MistakeSource> }>();

  for (const trade of trades) {
    for (const mistake of trade.mistakes) {
      const entry = labels.get(mistake.label) ?? { ids: new Set(), sources: new Set() };
      entry.ids.add(trade.id);
      entry.sources.add(mistake.source);
      labels.set(mistake.label, entry);
    }
  }

  const summaries: MistakeSummary[] = [];

  for (const [label, { ids, sources }] of labels) {
    const withMistake = trades.filter((t) => ids.has(t.id));
    const withoutMistake = trades.filter((t) => !ids.has(t.id));

    const a = summariseCohort(withMistake);
    const b = summariseCohort(withoutMistake);

    // Both cohorts must clear the threshold *on the R-bearing trades*, not on
    // raw counts: expectancy is computed from those alone, so twelve trades of
    // which two have an R multiple is a two-trade comparison wearing a twelve.
    const comparable =
      a.withR >= MIN_COMPARISON_SAMPLE &&
      b.withR >= MIN_COMPARISON_SAMPLE &&
      a.expectancy !== null &&
      b.expectancy !== null;

    summaries.push({
      label,
      sources: Array.from(sources),
      withMistake: a,
      withoutMistake: b,
      expectancyGap: comparable ? a.expectancy! - b.expectancy! : null,
      tradeIds: Array.from(ids),
    });
  }

  // Most frequent first: frequency is the finding that needs no statistics.
  return summaries.sort((x, y) => y.withMistake.trades - x.withMistake.trades);
}

/**
 * The mistakes this app can detect on its own, with no configuration.
 *
 * Each returns a label or null. Null means "not detected OR not determinable"
 * -- and those are deliberately the same answer here, because neither is a
 * mistake. A trade with no target recorded has not exited early; it has an
 * unrecorded target, and inventing a verdict either way would be the
 * fabrication this app exists to avoid.
 */
export const DETECTED_LABELS = {
  movedStop: "Moved stop",
  movedTarget: "Moved target",
  exitedEarly: "Exited before target",
  oversized: "Oversized position",
} as const;

export interface DetectionInput {
  trade: MistakeTrade;
  /** Whether the edit history shows the stop / target being changed. Null when
   *  history wasn't available for this trade. */
  stopMoved: boolean | null;
  targetMoved: boolean | null;
  /** The trader's own median risk %, across their closed trades. Null when too
   *  few trades carry one to establish a normal. */
  medianRisk: number | null;
}

export function detectMistakes(input: DetectionInput): string[] {
  const found: string[] = [];
  const { trade, stopMoved, targetMoved, medianRisk } = input;

  if (stopMoved === true) found.push(DETECTED_LABELS.movedStop);
  if (targetMoved === true) found.push(DETECTED_LABELS.movedTarget);

  // Only counts as leaving money behind if the trade actually won. Exiting
  // short of target on a loser is a stop being hit, which is the plan working.
  if ((trade.dollar_pl ?? 0) > 0 && exitedBeforeTarget(trade) === true) {
    found.push(DETECTED_LABELS.exitedEarly);
  }

  if (medianRisk !== null && trade.risk_percent != null) {
    if (trade.risk_percent > medianRisk * OVERSIZE_MULTIPLE) {
      found.push(DETECTED_LABELS.oversized);
    }
  }

  return found;
}

/** Median risk % across trades that recorded one. Null below the sample
 *  threshold -- one number is not a habit to measure "oversized" against. */
export function medianRiskPercent(trades: Pick<MistakeTrade, "risk_percent">[]): number | null {
  const risks = trades
    .map((t) => t.risk_percent)
    .filter((r): r is number => r != null)
    .sort((a, b) => a - b);

  if (risks.length < MIN_COMPARISON_SAMPLE) return null;
  const mid = Math.floor(risks.length / 2);
  return risks.length % 2 === 0 ? (risks[mid - 1] + risks[mid]) / 2 : risks[mid];
}
