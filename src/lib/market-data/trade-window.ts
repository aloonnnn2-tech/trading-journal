// The trade chart's view of a trade (Phase 4C, issue 5 of docs/design-audit.md):
// which bars to fetch, which to show, where the entry and exit markers go,
// and whether the trade's prices even belong on those bars.
//
// The chart used to load two years of daily bars and fit all ~500 into the
// width, so a trade's entry, stop and target -- a few dollars apart -- were
// squashed onto one line. It now opens on the holding period. The bar size
// was automatic from the hold (2026-09-28); since 2026-10-10 it opens on
// daily bars and the user picks any other size (Alon's request).
//
// Pure: no fetching, no chart library. Times are unix seconds, UTC.

/** Every bar size the chart offers, shortest first. Yahoo's own names. */
export const TIMEFRAMES = ["1m", "5m", "15m", "60m", "1d", "1wk", "1mo"] as const;
export type BarInterval = (typeof TIMEFRAMES)[number];

/** What the chart opens on. */
export const DEFAULT_TIMEFRAME: BarInterval = "1d";

/** Button label and the word used in sentences ("Yahoo keeps 5-minute bars"). */
export const TIMEFRAME_LABELS: Record<BarInterval, { short: string; long: string }> = {
  "1m": { short: "1m", long: "1-minute" },
  "5m": { short: "5m", long: "5-minute" },
  "15m": { short: "15m", long: "15-minute" },
  "60m": { short: "1h", long: "hourly" },
  "1d": { short: "1D", long: "daily" },
  "1wk": { short: "1W", long: "weekly" },
  "1mo": { short: "1M", long: "monthly" },
};

/** Daily and longer bars are judged by calendar date, not by seconds. */
export function isCalendarInterval(interval: BarInterval): boolean {
  return interval === "1d" || interval === "1wk" || interval === "1mo";
}

export interface Bar {
  /** Bar start, unix seconds UTC. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const DAY = 86_400;

/** How far back Yahoo keeps each intraday bar size -- with a day's margin,
 *  because asking one second past the limit fails the whole request. Daily
 *  and longer go back decades. `said` is the limit as the user reads it. */
const RETENTION: Partial<Record<BarInterval, { seconds: number; said: string }>> = {
  "1m": { seconds: 29 * DAY, said: "30 days" },
  "5m": { seconds: 59 * DAY, said: "60 days" },
  "15m": { seconds: 59 * DAY, said: "60 days" },
  "60m": { seconds: 729 * DAY, said: "2 years" },
};

/** The longest range Yahoo serves in one request: 1-minute bars come at most
 *  8 days at a time. The bars route allows ten years for everything else. */
const MAX_SPAN: Partial<Record<BarInterval, number>> = { "1m": 7 * DAY };
const ROUTE_MAX_SPAN = 10 * 365 * DAY;

/** How much context to fetch either side, so the chart can be scrolled out
 *  from the holding period without refetching. */
const CONTEXT: Record<BarInterval, { before: number; after: number }> = {
  "1m": { before: DAY, after: DAY },
  "5m": { before: 4 * DAY, after: 2 * DAY },
  "15m": { before: 10 * DAY, after: 5 * DAY },
  "60m": { before: 20 * DAY, after: 10 * DAY },
  "1d": { before: 150 * DAY, after: 60 * DAY },
  "1wk": { before: 2 * 365 * DAY, after: 365 * DAY },
  "1mo": { before: 6 * 365 * DAY, after: 2 * 365 * DAY },
};

/** Each intraday bar size's length (calendar bars are judged by date). */
const INTERVAL_SECONDS: Record<BarInterval, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "60m": 3600,
  "1d": DAY,
  "1wk": 7 * DAY,
  "1mo": 31 * DAY,
};

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

/** The exchange-local month of a moment, as a sortable number. */
function localMonth(time: number, timeZone: string): number {
  const d = new Date((time + zoneOffset(timeZone, time)) * 1000);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/** Whether a moment falls on a daily, weekly or monthly bar, by the
 *  market's calendar. A weekly bar covers the seven days from its start. */
function onCalendarBar(barTime: number, moment: number, interval: BarInterval, timeZone: string): boolean {
  if (interval === "1mo") return localMonth(barTime, timeZone) === localMonth(moment, timeZone);
  const start = localDay(barTime, timeZone);
  const day = localDay(moment, timeZone);
  return interval === "1wk" ? day >= start && day < start + 7 : day === start;
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
  if (isCalendarInterval(interval)) {
    for (const i of [before, before + 1]) {
      if (i >= 0 && i < bars.length && onCalendarBar(bars[i].time, moment, interval, timeZone)) return { index: i, inside: true };
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
 * Whether a bar size can show a trade at all. Yahoo drops intraday bars after
 * a while (1-minute after 30 days, 5- and 15-minute after 60, hourly after
 * two years), so an older trade's entry has no bars at that size -- the
 * chart greys the button out with this reason rather than showing an empty
 * or unrelated chart.
 */
export function timeframeAvailability(
  interval: BarInterval,
  entry: number,
  now: number,
): { ok: true } | { ok: false; reason: string } {
  const keep = RETENTION[interval];
  if (keep && now - entry > keep.seconds) {
    return { ok: false, reason: `Yahoo keeps ${TIMEFRAME_LABELS[interval].long} bars for ${keep.said}; this trade is older.` };
  }
  return { ok: true };
}

/**
 * The range to fetch for a trade at one bar size: the holding period (an open
 * trade's runs to `now`) with context either side, never older than Yahoo
 * keeps that size, and no longer than one request may span -- for 1-minute
 * bars that is a week, so a longer hold shows the week from just before the
 * entry.
 */
export function chooseBars(
  entry: number,
  exit: number | null,
  now: number,
  interval: BarInterval = DEFAULT_TIMEFRAME,
): BarRequest {
  const end = exit ?? now;
  const context = CONTEXT[interval];
  let period1 = entry - context.before;
  const keep = RETENTION[interval];
  if (keep) period1 = Math.max(period1, now - keep.seconds);
  let period2 = Math.min(end + context.after, now);
  const span = MAX_SPAN[interval] ?? ROUTE_MAX_SPAN;
  if (period2 - period1 > span) period2 = period1 + span;
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
 * "week of 31 Aug 2026", "Sep 2026", or "2 Sep 2026, 09:50" for an
 * intraday one. Read from UTC after shifting by
 * the exchange offset, so it's the same on the server, in any browser and in
 * any viewer's timezone.
 */
export function formatBarTime(time: number, timeZone: string, interval: BarInterval): string {
  const d = new Date((time + zoneOffset(timeZone, time)) * 1000);
  const date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  if (interval === "1mo") return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  if (interval === "1wk") return `week of ${date}`;
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
