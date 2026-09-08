import { MIN_SEGMENT_TRADES, type SegmentableTrade } from "@/lib/segments/engine";

// Risk behaviour: how much was risked, how consistently, and whether it moved
// with circumstances it shouldn't have.
//
// **This module reports, it does not prescribe.** Every figure is measured
// against the trader's OWN distribution -- "11 trades exceeded 2%, against
// your median of 0.6%" -- never against an external rule about what risk ought
// to be. There is no correct risk percentage, and a journal that invents one
// is giving financial instruction dressed as analysis.
//
// Pure functions over rows the caller fetched, in chronological order.

/** Both sides of a comparison need this before it is reported. */
export const MIN_COMPARISON = MIN_SEGMENT_TRADES;

/**
 * A trade is flagged when its risk exceeds this multiple of the trader's own
 * median. Three times is far enough outside a normal spread to be a decision
 * rather than drift, and it is relative -- someone whose median is 0.2% and
 * someone whose median is 2% both get judged against themselves.
 */
export const OUTLIER_MULTIPLE = 3;

export interface RiskTrade extends SegmentableTrade {
  id: string;
  ticker: string | null;
  exit_date: string;
  dollar_pl: number | null;
  r_multiple: number | null;
  risk_percent: number | null;
  position_size: number | null;
}

export interface Spread {
  /** Values the figures rest on. */
  n: number;
  median: number | null;
  mean: number | null;
  min: number | null;
  max: number | null;
  /** Population standard deviation. Null below two values, where spread is
   *  not a meaningful idea. */
  stdev: number | null;
}

export interface RiskBand {
  label: string;
  trades: number;
}

export interface Comparison {
  label: string;
  mean: number | null;
  n: number;
}

export interface RiskOutlier {
  tradeId: string;
  ticker: string | null;
  exitDate: string;
  riskPercent: number;
  /** How many times the median this trade risked. */
  timesMedian: number;
}

export interface RiskReport {
  /** Closed trades considered, and how many recorded a risk percentage. */
  tradesConsidered: number;
  risk: Spread;
  distribution: RiskBand[];
  /** Risk on the trade AFTER a loss, versus after a win. */
  sequence: { afterLoss: Comparison; afterWin: Comparison };
  /** Risk on trades opened while the account sat below its running peak. */
  drawdown: { inDrawdown: Comparison; atHighs: Comparison };
  /** Risk on trades that went on to win, versus lose. Descriptive only --
   *  risking more does not cause a loss, and the pair must not be read that
   *  way round. */
  outcome: { winners: Comparison; losers: Comparison };
  positionSize: Spread;
  /** Spread of position size relative to its own mean. A high value means
   *  sizing varied a lot; it is not itself good or bad. */
  positionSizeVariation: number | null;
  outliers: RiskOutlier[];
}

const BANDS: { label: string; min: number; max: number }[] = [
  { label: "Under 0.25%", min: -Infinity, max: 0.25 },
  { label: "0.25–0.5%", min: 0.25, max: 0.5 },
  { label: "0.5–1%", min: 0.5, max: 1 },
  { label: "1–2%", min: 1, max: 2 },
  { label: "2–5%", min: 2, max: 5 },
  { label: "Over 5%", min: 5, max: Infinity },
];

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

export function spread(values: number[]): Spread {
  const m = mean(values);
  return {
    n: values.length,
    median: median(values),
    mean: m,
    min: values.length > 0 ? Math.min(...values) : null,
    max: values.length > 0 ? Math.max(...values) : null,
    stdev:
      values.length > 1 && m !== null
        ? Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length)
        : null,
  };
}

/** A comparison is only reported once it rests on enough trades; below that
 *  the mean is returned as null rather than as a number nobody should read. */
function comparison(label: string, values: number[]): Comparison {
  return {
    label,
    n: values.length,
    mean: values.length >= MIN_COMPARISON ? mean(values) : null,
  };
}

export function buildRiskReport(trades: RiskTrade[]): RiskReport {
  const risks = trades.map((t) => t.risk_percent).filter((v): v is number => v != null);
  const riskSpread = spread(risks);
  const medianRisk = riskSpread.median;

  // ---- Sequence: what the previous trade did ------------------------------
  //
  // Walks the journal in order, so `trades` must arrive chronologically. The
  // pairing is "the trade that followed a loss", not "losing trades".
  const afterLoss: number[] = [];
  const afterWin: number[] = [];
  for (let i = 1; i < trades.length; i++) {
    const risk = trades[i].risk_percent;
    if (risk == null) continue;
    const previous = trades[i - 1].dollar_pl ?? 0;
    // Break-even is neither, so it starts no sequence either way.
    if (previous < 0) afterLoss.push(risk);
    else if (previous > 0) afterWin.push(risk);
  }

  // ---- Drawdown: where the account stood when the trade was taken ---------
  //
  // Equity is accumulated as each trade closes; a trade counts as "in
  // drawdown" when the running total BEFORE it sat below its previous peak.
  // Using the state before the trade is what makes this about the decision
  // rather than about its result.
  const inDrawdown: number[] = [];
  const atHighs: number[] = [];
  let equity = 0;
  let peak = 0;
  for (const trade of trades) {
    const risk = trade.risk_percent;
    if (risk != null) (equity < peak ? inDrawdown : atHighs).push(risk);
    equity += trade.dollar_pl ?? 0;
    peak = Math.max(peak, equity);
  }

  // ---- Outcome ------------------------------------------------------------
  const winners = trades.filter((t) => (t.dollar_pl ?? 0) > 0);
  const losers = trades.filter((t) => (t.dollar_pl ?? 0) < 0);
  const riskOf = (list: RiskTrade[]) =>
    list.map((t) => t.risk_percent).filter((v): v is number => v != null);

  // ---- Position sizing ----------------------------------------------------
  const sizes = trades.map((t) => t.position_size).filter((v): v is number => v != null);
  const sizeSpread = spread(sizes);

  // ---- Outliers -----------------------------------------------------------
  const outliers: RiskOutlier[] =
    medianRisk === null || medianRisk <= 0
      ? []
      : trades
          .filter((t) => t.risk_percent != null && t.risk_percent > medianRisk * OUTLIER_MULTIPLE)
          .map((t) => ({
            tradeId: t.id,
            ticker: t.ticker,
            exitDate: t.exit_date,
            riskPercent: t.risk_percent as number,
            timesMedian: (t.risk_percent as number) / medianRisk,
          }))
          .sort((a, b) => b.riskPercent - a.riskPercent);

  return {
    tradesConsidered: trades.length,
    risk: riskSpread,
    distribution: BANDS.map((band) => ({
      label: band.label,
      // Half-open [min, max) so each trade lands in exactly one band.
      trades: risks.filter((v) => v >= band.min && v < band.max).length,
    })),
    sequence: {
      afterLoss: comparison("After a loss", afterLoss),
      afterWin: comparison("After a win", afterWin),
    },
    drawdown: {
      inDrawdown: comparison("While in drawdown", inDrawdown),
      atHighs: comparison("At or near highs", atHighs),
    },
    outcome: {
      winners: comparison("Trades that won", riskOf(winners)),
      losers: comparison("Trades that lost", riskOf(losers)),
    },
    positionSize: sizeSpread,
    positionSizeVariation:
      sizeSpread.stdev !== null && sizeSpread.mean !== null && sizeSpread.mean !== 0
        ? sizeSpread.stdev / sizeSpread.mean
        : null,
    outliers,
  };
}
