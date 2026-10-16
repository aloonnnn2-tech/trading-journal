import { CircuitBreaker, resilientFetch } from "@/lib/http/resilient-fetch";
import { isCalendarInterval, type BarInterval } from "./trade-window";

/**
 * Best-effort guess at the symbol Yahoo's chart endpoint expects.
 *
 * The exchange/quote currency isn't stored anywhere, so this infers it from
 * asset_type: crypto tickers need a `-USD` pair suffix, forex needs `=X`.
 * On the trade card the user can correct a wrong guess and the correction is
 * remembered per-ticker in localStorage.
 *
 * Shared with the scheduled auto-execution job so a background sweep resolves
 * symbols exactly as the chart does — otherwise a crypto trade would
 * auto-execute in the browser (where "BTCUSD" becomes "BTC-USD") but never
 * in the background, where the raw ticker returns no price data.
 */
export function guessYahooSymbol(ticker: string, assetType: string | null): string {
  const clean = ticker.trim().toUpperCase().replace(/[\s/\\-]/g, "");
  if (!clean) return "";
  const type = (assetType ?? "").toLowerCase();
  if (type.includes("crypto")) {
    const base = clean.replace(/USDT?$/, "") || clean;
    return `${base}-USD`;
  }
  if (type.includes("forex") || type.includes("fx")) {
    return `${clean}=X`;
  }
  return clean;
}

export interface Candle {
  time: string; // "YYYY-MM-DD"
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface YahooFetchResult {
  candles: Candle[];
  /** Last traded price, straight from Yahoo's quote meta. Null if unavailable. */
  currentPrice: number | null;
  /** Today's session high/low -- what auto-execution watches for a
   *  stop-loss/take-profit/entry touch, since it reflects the current session
   *  even when today's daily candle isn't finalized yet. */
  dayHigh: number | null;
  dayLow: number | null;
  /** When Yahoo says this quote was last updated. dayHigh/dayLow don't reset
   *  until the next session starts, so this is what tells auto-execution
   *  apart a live range from one that finished hours (or a weekend) ago --
   *  see decideAutoExecution's staleness check. */
  quoteTime: Date | null;
}

// Yahoo's endpoint is unofficial/undocumented. Its likeliest failure is a
// transient blip (a dropped connection, a momentary 5xx or 429), worth a
// couple of short retries; a 4xx such as 404 for an unknown symbol is an
// answer, not an outage, and comes back as null.
//
// A real outage THROWS UpstreamUnavailableError instead of returning null,
// so the chart can say "market data temporarily unavailable" rather than
// "no price history for this symbol". Every attempt has a timeout -- the
// old retry loop had none, so a hung connection held the request until the
// platform killed it. The breaker is per serverless instance; see
// src/lib/http/resilient-fetch.ts.
const yahooBreaker = new CircuitBreaker(5, 30_000);

/** Worst case: 3 attempts of 6s plus about 2.3s of backoff, inside the 26s function budget. */
function fetchYahoo(url: string, revalidate: number): Promise<Response> {
  return resilientFetch(
    url,
    { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate } },
    { upstream: "Yahoo market data", timeoutMs: 6_000, idempotent: true, attempts: 3, breaker: yahooBreaker },
  );
}

// Yahoo Finance's undocumented chart endpoint -- no API key required, but
// unofficial and could change or start rate-limiting without notice. Only
// covers listed equities/ETFs/indices/major crypto pairs by plain ticker,
// not forex pairs, so callers should skip symbols they know are forex.
//
// Shared by the interactive chart route (/api/market-data/candles) and the
// scheduled auto-execution job, so both read prices the same way.
export async function fetchYahooCandles(
  symbol: string,
  options: { range?: string; revalidate?: number } = {},
): Promise<YahooFetchResult | null> {
  const { range = "2y", revalidate = 300 } = options;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const res = await fetchYahoo(url, revalidate);
  if (!res.ok) return null;

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) return null;

  const timestamps: number[] = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const { open = [], high = [], low = [], close = [] } = quote as Record<string, (number | null)[]>;
  const meta = result.meta ?? {};

  // Each daily bar's calendar date has to be read in the *exchange's* local
  // time, not UTC. A stock's bar is stamped at that market's open (always
  // mid-morning local, which for every exchange this app deals with never
  // crosses a UTC day boundary, so slicing the UTC ISO string happened to
  // give the right date) -- but a forex pair's bar is stamped at its
  // session start, which for Europe/London is 23:00 UTC the *previous*
  // evening. Slicing that in UTC dated every single forex candle one full
  // day earlier than the day it actually represents -- confirmed against
  // real EURUSD=X data, where every bar in a 5-day pull came back a day
  // off. Stocks and 24/7 crypto (already UTC) were never affected, which is
  // why this went unnoticed until someone compared a forex chart here
  // against another platform bar-by-bar.
  const timeZone: string = meta.exchangeTimezoneName ? String(meta.exchangeTimezoneName) : "UTC";
  let dateFormatter: Intl.DateTimeFormat;
  try {
    dateFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    // This is an unofficial, undocumented endpoint -- a malformed timezone
    // name shouldn't take down candle fetching entirely for that symbol
    // when falling back to the old (occasionally-off-by-one-day, but never
    // crashing) UTC behavior is strictly better than no chart at all.
    dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
  }

  const candles: Candle[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (open[i] == null || high[i] == null || low[i] == null || close[i] == null) continue;
    candles.push({
      // en-CA formats as YYYY-MM-DD directly, matching Candle.time's shape.
      time: dateFormatter.format(new Date(timestamps[i] * 1000)),
      open: open[i]!,
      high: high[i]!,
      low: low[i]!,
      close: close[i]!,
    });
  }
  return {
    candles,
    currentPrice: typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : null,
    dayHigh: typeof meta.regularMarketDayHigh === "number" ? meta.regularMarketDayHigh : null,
    dayLow: typeof meta.regularMarketDayLow === "number" ? meta.regularMarketDayLow : null,
    quoteTime: typeof meta.regularMarketTime === "number" ? new Date(meta.regularMarketTime * 1000) : null,
  };
}

/**
 * Just the session high/low, for the background job -- asks for the
 * shortest range Yahoo will serve since the candle history is irrelevant
 * there, and skips Next's fetch cache so a sweep never acts on a stale
 * snapshot.
 */
export async function fetchDayRange(
  symbol: string,
): Promise<Pick<YahooFetchResult, "dayHigh" | "dayLow" | "currentPrice" | "quoteTime"> | null> {
  const result = await fetchYahooCandles(symbol, { range: "5d", revalidate: 0 });
  if (!result) return null;
  return {
    dayHigh: result.dayHigh,
    dayLow: result.dayLow,
    currentPrice: result.currentPrice,
    quoteTime: result.quoteTime,
  };
}

export interface YahooBarsResult {
  /** Unix seconds UTC, bar start. See trade-window.ts. */
  bars: { time: number; open: number; high: number; low: number; close: number }[];
  /** The exchange's IANA timezone (e.g. America/New_York), so the chart can
   *  label bars in the market's own time. A zone, not Yahoo's `gmtoffset`:
   *  that's the offset today, and it's an hour wrong for a winter trade read
   *  in summer. */
  timeZone: string;
}

/**
 * Bars of one size over a date range -- the trade chart's holding-period view
 * (Phase 4C). Same unofficial endpoint and retries as fetchYahooCandles, but
 * with period1/period2 in place of a range and unix times kept as they are,
 * because intraday bars have no calendar date of their own. Yahoo keeps 5m
 * bars for 60 days and 60m for two years; trade-window.ts stays inside that.
 *
 * A range entirely in the past can't change, so it's cached for a day; one
 * reaching today refreshes like the daily chart.
 */
export async function fetchYahooBars(
  symbol: string,
  request: { interval: BarInterval; period1: number; period2: number },
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<YahooBarsResult | null> {
  const { interval, period1, period2 } = request;
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${period1}&period2=${period2}&interval=${interval}` +
    // Pre- and after-market bars for intraday views: plenty of fills happen
    // outside regular hours, and without them those trades have no bar.
    (isCalendarInterval(interval) ? "" : "&includePrePost=true");
  const settled = period2 < nowSeconds - 86_400;
  const res = await fetchYahoo(url, settled ? 86_400 : 300);
  if (!res.ok) return null;

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) return null;

  const timestamps: number[] = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const { open = [], high = [], low = [], close = [] } = quote as Record<string, (number | null)[]>;
  const timeZone = result.meta?.exchangeTimezoneName ? String(result.meta.exchangeTimezoneName) : "UTC";

  const bars: YahooBarsResult["bars"] = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (open[i] == null || high[i] == null || low[i] == null || close[i] == null) continue;
    // Weekly and monthly answers can end with the live period stamped at or
    // before the last full one; the chart needs strictly rising times.
    if (bars.length > 0 && timestamps[i] <= bars[bars.length - 1].time) continue;
    bars.push({ time: timestamps[i], open: open[i]!, high: high[i]!, low: low[i]!, close: close[i]! });
  }
  return { bars, timeZone };
}
