import { MIN_SEGMENT_TRADES } from "@/lib/segments/engine";
import { captureRatio } from "./calculate";
import type { ExcursionRow } from "./queries";

// Aggregate MAE / MFE, and the exit-efficiency figure that falls out of it.
//
// Only rows with status 'ok' carry figures, so every average here is over
// those alone -- and the count they rest on travels with them. A journal where
// half the trades are same-day would otherwise show an "average MAE" that
// quietly covered half the trades while looking like it covered all of them.

/** What the aggregates need from a trade, alongside its excursion row. */
export interface ExcursionTrade {
  id: string;
  dollar_pl: number | null;
  entry_price: number | null;
  exit_price: number | null;
  /** Needed to express the realised move in R on the same basis as the MFE. */
  stop_loss: number | null;
  direction: string | null;
  strategies: string[];
}

/**
 * How capture ratios are grouped.
 *
 * "Gave it back" is its own band rather than being folded into "under 25%":
 * a trade that ran in your favour and still closed at a loss is a different
 * problem from one that took a small piece, and the brief names it directly
 * ("giving back profits"). Collapsing them would hide the worse of the two.
 */
export const CAPTURE_BANDS = [
  { label: "Gave it back", min: -Infinity, max: 0 },
  { label: "Under 25%", min: 0, max: 0.25 },
  { label: "25-50%", min: 0.25, max: 0.5 },
  { label: "50-75%", min: 0.5, max: 0.75 },
  { label: "Over 75%", min: 0.75, max: Infinity },
] as const;

export interface CaptureBand {
  label: string;
  trades: number;
}

export interface ExcursionAverages {
  /** Trades these averages were computed from. */
  trades: number;
  avgMaePercent: number | null;
  avgMfePercent: number | null;
  avgMaeR: number | null;
  avgMfeR: number | null;
  /** How many of `trades` carried an R multiple, since the R averages rest on
   *  those alone -- a trade with no stop recorded has no R. */
  withR: number;
  /** Median share of the favourable move that was kept. Median rather than
   *  mean: one trade exiting near a spike produces a ratio far above 1 and
   *  would drag a mean somewhere no trade actually is. */
  medianCapture: number | null;
  captureSample: number;
  /**
   * Average realised move in R, on the SAME price basis as `avgMfeR` -- the
   * move divided by |entry - stop| per unit.
   *
   * Deliberately NOT the trade's stored `r_multiple`, which is
   * `dollar_pl / risk_amount`: net of commission, over the dollar risk the
   * trader entered. Both are legitimate, but only this one is comparable with
   * the MFE figure beside it, and their ratio is exactly the capture. Mixing
   * the two bases would put a net number next to a gross one and invite the
   * reader to subtract them.
   */
  avgRealisedR: number | null;
  realisedRSample: number;
  /** Distribution behind the median -- fifteen trades at 20% is a different
   *  problem from a split of runners and scratches, which a median hides. */
  captureBands: CaptureBand[];
}

export interface ExcursionReport {
  overall: ExcursionAverages;
  winners: ExcursionAverages;
  losers: ExcursionAverages;
  byStrategy: { strategy: string; stats: ExcursionAverages }[];
  /** Rows answered but carrying no figures, keyed by why. */
  unavailable: Record<string, number>;
  /** True when any usable row rests on partial end-day bars, which is the
   *  normal case and must be disclosed wherever these are shown. */
  includesPartialDays: boolean;
  /** Closed trades with no excursion row at all -- never computed. */
  notComputed: number;
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** The realised move in the position's favour, in price terms -- the numerator
 *  of the capture ratio. Mirrors favourableMove() in calculate.ts. */
function realisedMove(trade: ExcursionTrade): number | null {
  if (trade.entry_price == null || trade.exit_price == null || !trade.direction) return null;
  return trade.direction === "short"
    ? trade.entry_price - trade.exit_price
    : trade.exit_price - trade.entry_price;
}

/** How far the MFE sat from entry, in price terms. Direction-aware, mirroring
 *  favourableMove() in calculate.ts. */
function mfeMoveOf(trade: ExcursionTrade, row: ExcursionRow): number | null {
  if (row.mfe_price == null || trade.entry_price == null) return null;
  return trade.direction === "short"
    ? trade.entry_price - row.mfe_price
    : row.mfe_price - trade.entry_price;
}

/** Risk per unit, the denominator both R figures share. Null when no stop was
 *  recorded, or when the stop sits at the entry. */
function riskPerUnit(trade: ExcursionTrade): number | null {
  if (trade.stop_loss == null || trade.entry_price == null) return null;
  const risk = Math.abs(trade.entry_price - trade.stop_loss);
  return risk > 0 ? risk : null;
}

function bandCaptures(captures: number[]): CaptureBand[] {
  return CAPTURE_BANDS.map((band) => ({
    label: band.label,
    // Half-open [min, max) so every ratio lands in exactly one band.
    trades: captures.filter((c) => c >= band.min && c < band.max).length,
  }));
}

function summarise(pairs: { trade: ExcursionTrade; row: ExcursionRow }[]): ExcursionAverages {
  const maePercents = pairs.map((p) => p.row.mae_percent).filter((v): v is number => v != null);
  const mfePercents = pairs.map((p) => p.row.mfe_percent).filter((v): v is number => v != null);
  const maeRs = pairs.map((p) => p.row.mae_r).filter((v): v is number => v != null);
  const mfeRs = pairs.map((p) => p.row.mfe_r).filter((v): v is number => v != null);

  const captures: number[] = [];
  const realisedRs: number[] = [];

  for (const { trade, row } of pairs) {
    const realised = realisedMove(trade);
    const ratio = realised === null ? null : captureRatio(realised, mfeMoveOf(trade, row));
    if (ratio !== null) captures.push(ratio);

    // Same denominator as the stored mfe_r, so the two are directly
    // comparable and realised / available equals the capture.
    const risk = riskPerUnit(trade);
    if (realised !== null && risk !== null) realisedRs.push(realised / risk);
  }

  return {
    trades: pairs.length,
    avgMaePercent: mean(maePercents),
    avgMfePercent: mean(mfePercents),
    avgMaeR: mean(maeRs),
    avgMfeR: mean(mfeRs),
    withR: maeRs.length,
    medianCapture: median(captures),
    captureSample: captures.length,
    avgRealisedR: mean(realisedRs),
    realisedRSample: realisedRs.length,
    captureBands: bandCaptures(captures),
  };
}

export function buildExcursionReport(
  trades: ExcursionTrade[],
  rows: ExcursionRow[],
): ExcursionReport {
  const byTradeId = new Map(rows.map((row) => [row.trade_id, row]));

  const usable: { trade: ExcursionTrade; row: ExcursionRow }[] = [];
  const unavailable: Record<string, number> = {};
  let notComputed = 0;
  let includesPartialDays = false;

  for (const trade of trades) {
    const row = byTradeId.get(trade.id);
    if (!row) {
      notComputed += 1;
      continue;
    }
    if (row.status !== "ok") {
      unavailable[row.status] = (unavailable[row.status] ?? 0) + 1;
      continue;
    }
    if (row.includes_partial_days) includesPartialDays = true;
    usable.push({ trade, row });
  }

  const byStrategyMap = new Map<string, { trade: ExcursionTrade; row: ExcursionRow }[]>();
  for (const pair of usable) {
    for (const strategy of pair.trade.strategies) {
      (byStrategyMap.get(strategy) ?? byStrategyMap.set(strategy, []).get(strategy)!).push(pair);
    }
  }

  return {
    overall: summarise(usable),
    winners: summarise(usable.filter((p) => (p.trade.dollar_pl ?? 0) > 0)),
    losers: summarise(usable.filter((p) => (p.trade.dollar_pl ?? 0) < 0)),
    byStrategy: Array.from(byStrategyMap.entries())
      // The same floor Find My Edge uses: below it, an average is an anecdote.
      .filter(([, pairs]) => pairs.length >= MIN_SEGMENT_TRADES)
      .map(([strategy, pairs]) => ({ strategy, stats: summarise(pairs) }))
      .sort((a, b) => b.stats.trades - a.stats.trades),
    unavailable,
    includesPartialDays,
    notComputed,
  };
}
