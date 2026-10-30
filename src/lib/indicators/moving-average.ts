// Moving averages over a series of closes, oldest first. Each returns one
// value per close: null until there are enough closes to compute it, so
// index i always lines up with closes[i].

export type MovingAverageType = "sma" | "ema";

/** Simple moving average: the mean of the last `period` closes. */
export function sma(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (!Number.isInteger(period) || period < 1) return out;
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * Exponential moving average, seeded with the SMA of the first `period`
 * closes (the usual charting convention), then weighted 2 / (period + 1).
 */
export function ema(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (!Number.isInteger(period) || period < 1 || closes.length < period) return out;
  const k = 2 / (period + 1);
  let prev = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < closes.length; i++) {
    prev = closes[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function movingAverage(type: MovingAverageType, closes: number[], period: number): (number | null)[] {
  return type === "ema" ? ema(closes, period) : sma(closes, period);
}

/** "SMA 150", "EMA 21". */
export function movingAverageName(type: MovingAverageType, period: number): string {
  return `${type.toUpperCase()} ${period}`;
}
