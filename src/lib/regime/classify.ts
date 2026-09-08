import type { Candle } from "@/lib/market-data/yahoo";

// Classifying the market conditions a trade was closed in.
//
// **Only volatility.** The obvious companion axis -- bull / bear / sideways
// from the benchmark's own 200-day SMA -- is computable and was deliberately
// left out: measured against this journal it put 38 of 38 matched trades in
// "Bull", because the period covered contains no downturn. A breakdown with
// one row is not an analysis, and shipping it would imply a comparison the
// data cannot make. It becomes worth adding when a journal actually spans
// more than one trend, and the classifier below is shaped so that axis can
// slot in beside this one.
//
// **The rule is stated, not judged.** There is no canonical definition of a
// volatile market, so rather than pick an absolute threshold (which would be
// wrong for a different asset or a different decade) this measures the
// benchmark against ITS OWN history: realised volatility over a trailing
// window, split at the median of the whole series. "High volatility" therefore
// means "high for this benchmark over this period", which is a claim the data
// actually supports.

/** Trading days in the volatility window -- roughly one month. Long enough to
 *  be a regime rather than a single session, short enough to change. */
export const VOL_WINDOW = 20;

/** Trading days per year, for annualising. The convention. */
const TRADING_DAYS_PER_YEAR = 252;

/**
 * How far back to look for a trading day when a trade's date isn't one.
 *
 * A trade closed on a Saturday has no bar. Carrying forward to the previous
 * session is right; carrying forward indefinitely is not -- a trade dated
 * outside the benchmark's history would otherwise silently attach to whatever
 * bar happened to be nearest. Four days covers a weekend plus a holiday.
 */
const MAX_CARRY_FORWARD_DAYS = 4;

export type VolatilityBand = "high" | "low";

export interface DayRegime {
  /** Annualised realised volatility, as a fraction (0.128 = 12.8%). */
  volatility: number;
  band: VolatilityBand;
}

export interface RegimeSeries {
  /** Trading day (YYYY-MM-DD) to its regime. */
  byDay: Map<string, DayRegime>;
  /** The split point, so the UI can state what "high" means. */
  medianVolatility: number;
  /** Trading days classified. */
  days: number;
}

/** Population standard deviation. */
function stdev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Builds the volatility regime for every day the benchmark has enough history
 * for.
 *
 * Two passes on purpose: the band is relative to the median of the whole
 * series, so every volatility has to be known before any day can be labelled.
 * Labelling as it goes would make the earliest days' bands depend on a median
 * computed from almost nothing.
 */
export function buildRegimeSeries(candles: Candle[]): RegimeSeries | null {
  // Need one extra bar to compute the first window's returns.
  if (candles.length < VOL_WINDOW + 2) return null;

  const volatilities: { day: string; volatility: number }[] = [];

  for (let i = VOL_WINDOW; i < candles.length; i++) {
    const returns: number[] = [];
    for (let j = i - VOL_WINDOW + 1; j <= i; j++) {
      const previous = candles[j - 1].close;
      if (previous === 0) continue;
      returns.push((candles[j].close - previous) / previous);
    }
    if (returns.length === 0) continue;
    volatilities.push({
      day: candles[i].time,
      volatility: stdev(returns) * Math.sqrt(TRADING_DAYS_PER_YEAR),
    });
  }

  if (volatilities.length === 0) return null;

  const medianVolatility = median(volatilities.map((v) => v.volatility));
  const byDay = new Map<string, DayRegime>();
  for (const { day, volatility } of volatilities) {
    // Ties go to "low": a day exactly at the median is not high volatility.
    byDay.set(day, { volatility, band: volatility > medianVolatility ? "high" : "low" });
  }

  return { byDay, medianVolatility, days: byDay.size };
}

/**
 * The regime in force on `day`, carrying back to the most recent trading day.
 *
 * Returns null rather than guessing when nothing is within reach -- a trade
 * outside the benchmark's history must be reported as unmatched, not attached
 * to the nearest bar it can find. Without the carry-back, a quarter of a real
 * journal disappears: measured here, 12 of 50 trades closed on a weekend or
 * holiday and matched no bar at all.
 */
export function regimeOn(series: RegimeSeries, day: string): DayRegime | null {
  const direct = series.byDay.get(day);
  if (direct) return direct;

  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;

  for (let back = 1; back <= MAX_CARRY_FORWARD_DAYS; back++) {
    const previous = new Date(date.getTime() - back * 86_400_000).toISOString().slice(0, 10);
    const found = series.byDay.get(previous);
    if (found) return found;
  }
  return null;
}

/**
 * Asset types the equity benchmark does not describe.
 *
 * A crypto position filed under "S&P volatility" is a category error rather
 * than an approximation, so those trades are excluded and counted separately
 * instead of being quietly mislabelled. Anything without an asset type is
 * kept: in practice those are equities, and excluding them would throw away
 * more signal than the occasional mislabel costs.
 */
export function isBenchmarkRelevant(assetType: string | null): boolean {
  const type = (assetType ?? "").toLowerCase();
  return !type.includes("crypto") && !type.includes("forex") && !type.includes("fx");
}
