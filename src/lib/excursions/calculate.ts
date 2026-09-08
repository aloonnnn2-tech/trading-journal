import type { Candle } from "@/lib/market-data/yahoo";

// Maximum Adverse / Favourable Excursion: how far a trade moved against you
// after entry, and how far it moved in your favour before you closed it.
//
// **The honesty problem this file exists to handle.** The only price history
// available is DAILY bars (interval=1d), so:
//
//   - A trade opened and closed on the SAME DAY has exactly one bar, whose
//     high and low include movement before the entry and after the exit. That
//     is not a noisy excursion, it is a different number wearing the name --
//     so it is refused outright rather than reported.
//   - Even on a multi-day trade, the entry day's low may have occurred before
//     the entry, and the exit day's high after the exit. The figures are
//     therefore an OUTER BOUND: the real excursion is no worse than this.
//     `includesPartialDays` says so, and every surface that renders these must
//     pass that on rather than presenting them as exact.
//
// Nothing here fetches. Candles are handed in, so this is a pure function and
// the network failure modes live in queries.ts where they belong.

/** Why an excursion could not be computed. `ok` is the only success. */
export type ExcursionStatus =
  | "ok"
  /** Entry and exit fall on one daily bar -- see the header. */
  | "same_day"
  /** No bars covering the holding period: outside the history window, a
   *  delisted symbol, or a symbol the guesser got wrong. */
  | "no_data"
  /** Entry or exit price missing, so there is nothing to measure from. */
  | "no_prices"
  /** Without a direction there is no such thing as "in your favour". */
  | "no_direction"
  /** The price series came back coarser than daily, so its highs and lows
   *  span far more than the holding period. See isDailyResolution. */
  | "coarse_data";

export interface ExcursionInput {
  direction: string | null;
  entryPrice: number | null;
  exitPrice: number | null;
  /** Used to express the excursion in R. Null when no stop was recorded. */
  stopLoss: number | null;
  /** Local calendar day of entry/exit, YYYY-MM-DD, matching Candle.time. */
  entryDay: string;
  exitDay: string;
  candles: Candle[];
}

export interface ExcursionResult {
  status: ExcursionStatus;
  /** Worst price reached against the position. Null unless status is ok. */
  maePrice: number | null;
  /** Best price reached in the position's favour. */
  mfePrice: number | null;
  /** Signed % move in the trader's favour: MAE is normally negative, MFE
   *  positive. MAE can be positive when a trade never traded against you. */
  maePercent: number | null;
  mfePercent: number | null;
  /** The same excursions in R. Null when no stop was recorded, because R has
   *  no meaning without the risk it is a multiple of. */
  maeR: number | null;
  mfeR: number | null;
  /** How many daily bars the answer rests on. */
  candlesUsed: number;
  /** True when the entry or exit day's bar was included, so the figures are
   *  an outer bound rather than exact. */
  includesPartialDays: boolean;
}

function empty(status: ExcursionStatus): ExcursionResult {
  return {
    status,
    maePrice: null,
    mfePrice: null,
    maePercent: null,
    mfePercent: null,
    maeR: null,
    mfeR: null,
    candlesUsed: 0,
    includesPartialDays: false,
  };
}

/**
 * How far `price` sits in the position's favour, in price terms.
 *
 * The one line that makes shorts work: for a long, favour is up; for a short,
 * favour is down. Getting this backwards would report every short's best
 * moment as its worst.
 */
function favourableMove(price: number, entryPrice: number, isShort: boolean): number {
  return isShort ? entryPrice - price : price - entryPrice;
}

export function calculateExcursion(input: ExcursionInput): ExcursionResult {
  const { direction, entryPrice, exitPrice, stopLoss, entryDay, exitDay, candles } = input;

  if (entryPrice == null || exitPrice == null || entryPrice === 0) return empty("no_prices");
  if (direction !== "long" && direction !== "short") return empty("no_direction");
  // One bar cannot separate "before you entered" from "while you held".
  if (entryDay === exitDay) return empty("same_day");

  const isShort = direction === "short";

  // Inclusive of both end days: excluding them would return nothing at all for
  // a two-day hold, which is a large share of most journals. The cost is that
  // the result is an outer bound, which `includesPartialDays` reports.
  const window = candles.filter((candle) => candle.time >= entryDay && candle.time <= exitDay);
  if (window.length === 0) return empty("no_data");

  let best = -Infinity;
  let worst = Infinity;
  let mfePrice = entryPrice;
  let maePrice = entryPrice;

  for (const candle of window) {
    // Both extremes of every bar are candidates. Which one is favourable
    // depends on direction, so both are tested rather than assumed.
    for (const price of [candle.high, candle.low]) {
      const move = favourableMove(price, entryPrice, isShort);
      if (move > best) {
        best = move;
        mfePrice = price;
      }
      if (move < worst) {
        worst = move;
        maePrice = price;
      }
    }
  }

  // Risk per unit, for the R conversion. Null when no stop was recorded --
  // R without a stop would be a made-up denominator.
  const riskPerUnit = stopLoss != null ? Math.abs(entryPrice - stopLoss) : null;
  const hasRisk = riskPerUnit != null && riskPerUnit > 0;

  return {
    status: "ok",
    maePrice,
    mfePrice,
    maePercent: (worst / entryPrice) * 100,
    mfePercent: (best / entryPrice) * 100,
    maeR: hasRisk ? worst / riskPerUnit : null,
    mfeR: hasRisk ? best / riskPerUnit : null,
    candlesUsed: window.length,
    includesPartialDays: true,
  };
}

/**
 * What share of the favourable move the trade actually kept.
 *
 * This is Feature 5's core number, defined here because it is a pure function
 * of the same inputs and must not become a second definition elsewhere.
 *
 * Null when MFE is zero or negative -- the trade never moved in the trader's
 * favour, so there was nothing to capture and a percentage would divide by
 * roughly nothing and report a wild figure.
 */
export function captureRatio(
  realisedMove: number,
  mfeMove: number | null,
): number | null {
  if (mfeMove === null || mfeMove <= 0) return null;
  return realisedMove / mfeMove;
}

/**
 * Median gap between consecutive bars, in days.
 *
 * Exists because of a trap in the price API: asking for `range=max` with
 * `interval=1d` does NOT return 40 years of daily bars -- it silently returns
 * QUARTERLY ones (measured: AAPL over `max` gives 168 bars at a 92-day median
 * gap, against 2,513 daily bars over `10y`). A quarterly bar's high and low
 * span three months, so an excursion computed from one would be a wildly
 * overstated number wearing the right label.
 *
 * The range this app requests is chosen to avoid that, but the check runs
 * anyway: a silently-wrong number is the one failure mode this feature must
 * not have, and the provider is free to change its behaviour without telling
 * anyone.
 */
export function medianBarGapDays(candles: Candle[]): number | null {
  if (candles.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const gap =
      (new Date(candles[i].time).getTime() - new Date(candles[i - 1].time).getTime()) / 86_400_000;
    if (Number.isFinite(gap) && gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/**
 * Is this series daily?
 *
 * The threshold allows for weekends and holidays -- a genuinely daily series
 * of market data has a median gap of 1 day, and 4 leaves generous room without
 * admitting a weekly (7) or quarterly (92) series.
 */
export function isDailyResolution(candles: Candle[]): boolean {
  const gap = medianBarGapDays(candles);
  return gap !== null && gap <= 4;
}
