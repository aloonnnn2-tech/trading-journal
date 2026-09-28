// The trade chart's view of a trade (Phase 4C, issue 5 of docs/design-audit.md):
// which bars to fetch, which to show, where the entry and exit markers go,
// and whether the trade's prices even belong on those bars.
//
// The chart used to load two years of daily bars and fit all ~500 into the
// width, so a trade's entry, stop and target -- a few dollars apart -- were
// squashed onto one line. It now opens on the holding period, in a bar size
// that suits the hold (Alon chose automatic, 2026-09-28).
//
// Pure: no fetching, no chart library. Times are unix seconds, UTC.

export type BarInterval = "5m" | "60m" | "1d";

export interface Bar {
  /** Bar start, unix seconds UTC. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const DAY = 86_400;

/** How far back Yahoo keeps each bar size -- with a day's margin, because
 *  asking one second past the limit fails the whole request. */
const RETENTION: Record<Exclude<BarInterval, "1d">, number> = {
  "5m": 59 * DAY,
  "60m": 729 * DAY,
};

/** How much context to fetch either side, so the chart can be scrolled out
 *  from the holding period without refetching. */
const CONTEXT: Record<BarInterval, { before: number; after: number }> = {
  "5m": { before: 4 * DAY, after: 2 * DAY },
  "60m": { before: 20 * DAY, after: 10 * DAY },
  "1d": { before: 150 * DAY, after: 60 * DAY },
};

/** Each bar size's length. A daily bar is judged by calendar date instead. */
const INTERVAL_SECONDS: Record<BarInterval, number> = { "5m": 300, "60m": 3600, "1d": DAY };

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * A timezone's offset from UTC at one moment, in seconds -- e.g. -14400 for
 * New York in September, -18000 in November. Yahoo's own `gmtoffset` is the
 * offset *now*, so using it for a winter trade put every bar an hour off.
 * An unknown zone reads as UTC rather than failing the chart.
 */
export function zoneOffset(timeZone: string, time: number): number {
  let formatter = zoneFormatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      });
    } catch {
      return 0;
    }
    zoneFormatters.set(timeZone, formatter);
  }
  const whole = Math.floor(time);
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(whole * 1000))) parts[part.type] = Number(part.value);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second) / 1000;
  return asUtc - whole;
}

/** The exchange-local calendar date of a moment, as a sortable number. */
function localDay(time: number, timeZone: string): number {
  return Math.floor((time + zoneOffset(timeZone, time)) / DAY);
}

/**
 * The bar a trade's moment belongs to. `inside` is true when the moment falls
 * within that bar (for daily bars, on its calendar date). In a gap --
 * overnight, a weekend, before the open with no pre-market data -- it's the
 * NEXT bar, not the last one before: a 09:20 entry belongs by the 09:30 bar,
 * not the previous afternoon's. Nothing can be judged against a bar the
 * moment isn't in, so the mismatch check skips `inside: false`.
 */
export function locate(
  bars: Bar[],
  moment: number,
  interval: BarInterval,
  timeZone: string,
): { index: number; inside: boolean } {
  const before = barIndexAt(bars, moment);
  if (interval === "1d") {
    const day = localDay(moment, timeZone);
    for (const i of [before, before + 1]) {
      if (i >= 0 && i < bars.length && localDay(bars[i].time, timeZone) === day) return { index: i, inside: true };
    }
  } else if (before >= 0 && moment < bars[before].time + INTERVAL_SECONDS[interval]) {
    return { index: before, inside: true };
  }
  const next = before + 1;
  return next < bars.length ? { index: next, inside: false } : { index: -1, inside: false };
}

/** Bars shown either side of the holding period when the chart opens. */
export const VIEW_PADDING_BARS = 10;

export interface BarRequest {
  interval: BarInterval;
  period1: number;
  period2: number;
}

/**
 * The bar size and range to fetch for a trade: 5-minute bars for a hold of
 * up to a day while Yahoo still has them (60 days), hourly for up to 20 days
 * within two years, daily otherwise. An open trade's hold runs to `now`.
 * `force` picks the size instead -- the chart falls back to daily bars when
 * Yahoo has no intraday data for a symbol.
 */
export function chooseBars(entry: number, exit: number | null, now: number, force?: BarInterval): BarRequest {
  const end = exit ?? now;
  const hold = Math.max(0, end - entry);
  const age = now - entry;

  let interval: BarInterval = "1d";
  if (force) interval = force;
  else if (hold <= DAY && age < RETENTION["5m"]) interval = "5m";
  else if (hold <= 20 * DAY && age < RETENTION["60m"]) interval = "60m";

  const context = CONTEXT[interval];
  let period1 = entry - context.before;
  if (interval !== "1d") period1 = Math.max(period1, now - RETENTION[interval]);
  const period2 = Math.min(end + context.after, now);
  return { interval, period1: Math.floor(period1), period2: Math.ceil(period2) };
}

/** The index of the bar a moment falls in: the last bar starting at or
 *  before it. -1 when it is before the first bar. */
export function barIndexAt(bars: Bar[], moment: number): number {
  let lo = 0;
  let hi = bars.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time <= moment) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * The bars to open on: a few before the entry bar to a few after the exit bar
 * (or the last bar, for a trade still open). Logical indexes, as the chart's
 * time scale takes them. Null when the entry is outside the fetched bars.
 */
export function visibleRange(
  bars: Bar[],
  entryIndex: number,
  exitIndex: number,
  padding = VIEW_PADDING_BARS,
): { from: number; to: number } | null {
  if (entryIndex < 0 || bars.length === 0) return null;
  const end = exitIndex >= entryIndex ? exitIndex : bars.length - 1;
  return {
    from: Math.max(0, entryIndex - padding),
    to: Math.min(bars.length - 1, end + padding),
  };
}

export interface TradeMarker {
  time: number;
  position: "aboveBar" | "belowBar";
  shape: "arrowUp" | "arrowDown";
  text: string;
}

/**
 * ▲ at the entry bar and ▼ at the exit bar of a long; flipped for a short,
 * where the entry is the sell and the exit the buy back.
 */
export function tradeMarkers(
  bars: Bar[],
  entryIndex: number,
  exitIndex: number,
  direction: "long" | "short" | null,
): TradeMarker[] {
  const up = { position: "belowBar", shape: "arrowUp" } as const;
  const down = { position: "aboveBar", shape: "arrowDown" } as const;
  const short = direction === "short";
  const markers: TradeMarker[] = [];
  if (entryIndex >= 0) markers.push({ time: bars[entryIndex].time, ...(short ? down : up), text: "Entry" });
  if (exitIndex >= 0) markers.push({ time: bars[exitIndex].time, ...(short ? up : down), text: "Exit" });
  return markers;
}

/** How far outside a bar's range still counts as on it: rounding, and the
 *  gap between a fill and the bar's recorded extremes. */
const TOLERANCE = 0.005;

export interface PriceMismatch {
  label: "Entry" | "Exit";
  price: number;
  low: number;
  high: number;
  barTime: number;
}

/**
 * Whether the trade's own price sits on the market's bar for that moment.
 * Checks the entry, or the exit when there's no entry price. A mismatch
 * means the symbol, the date or the price is off -- or the data is
 * split-adjusted and the trade predates the split -- and the chart says so
 * rather than drawing lines that look like they belong to those bars.
 */
export function priceMismatch(
  bars: Bar[],
  levels: {
    entryPrice: number | null;
    entry: { index: number; inside: boolean };
    exitPrice: number | null;
    exit: { index: number; inside: boolean };
  },
): PriceMismatch | null {
  const check = (label: "Entry" | "Exit", price: number | null, at: { index: number; inside: boolean }): PriceMismatch | null => {
    const index = at.index;
    if (price == null || index < 0 || !at.inside) return null;
    const bar = bars[index];
    const slack = price * TOLERANCE;
    if (price >= bar.low - slack && price <= bar.high + slack) return null;
    return { label, price, low: bar.low, high: bar.high, barTime: bar.time };
  };
  if (levels.entryPrice != null) return check("Entry", levels.entryPrice, levels.entry);
  return check("Exit", levels.exitPrice, levels.exit);
}

/**
 * The price range to fit: the visible bars and the trade's own levels, so
 * entry, stop and target are never off-screen. With a mismatch, the trade's
 * levels alone -- the bars are somewhere else entirely, and fitting both
 * would squash the lines as badly as before.
 */
export function fitRange(
  barRange: { min: number; max: number } | null,
  levels: (number | null)[],
  mismatch: boolean,
): { min: number; max: number } | null {
  const own = levels.filter((v): v is number => v != null && Number.isFinite(v));
  const values = [...own];
  if (!mismatch && barRange) values.push(barRange.min, barRange.max);
  if (values.length === 0) return barRange;
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    // A single level: give it room rather than a zero-height scale.
    const pad = Math.abs(min) * 0.01 || 1;
    min -= pad;
    max += pad;
  }
  return { min, max };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A bar's time in the market's own clock: "2 Sep 2026" for a daily bar,
 * "2 Sep 2026, 09:50" for an intraday one. Read from UTC after shifting by
 * the exchange offset, so it's the same on the server, in any browser and in
 * any viewer's timezone.
 */
export function formatBarTime(time: number, timeZone: string, interval: BarInterval): string {
  const d = new Date((time + zoneOffset(timeZone, time)) * 1000);
  const date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  if (interval === "1d") return date;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/**
 * A market price for display. Yahoo sends floats with their binary noise
 * attached ("351.63000488"), so: two decimals from 1 up, six significant
 * digits below it (a sub-cent coin still reads).
 */
export function formatQuote(value: number): string {
  if (Math.abs(value) >= 1) return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value.toLocaleString("en-US", { maximumSignificantDigits: 6 });
}
