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
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    next: { revalidate },
  });
  if (!res.ok) return null;

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) return null;

  const timestamps: number[] = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const { open = [], high = [], low = [], close = [] } = quote as Record<string, (number | null)[]>;

  const candles: Candle[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (open[i] == null || high[i] == null || low[i] == null || close[i] == null) continue;
    candles.push({
      time: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
      open: open[i]!,
      high: high[i]!,
      low: low[i]!,
      close: close[i]!,
    });
  }

  const meta = result.meta ?? {};
  return {
    candles,
    currentPrice: typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : null,
    dayHigh: typeof meta.regularMarketDayHigh === "number" ? meta.regularMarketDayHigh : null,
    dayLow: typeof meta.regularMarketDayLow === "number" ? meta.regularMarketDayLow : null,
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
): Promise<{ dayHigh: number | null; dayLow: number | null; currentPrice: number | null } | null> {
  const result = await fetchYahooCandles(symbol, { range: "5d", revalidate: 0 });
  if (!result) return null;
  return { dayHigh: result.dayHigh, dayLow: result.dayLow, currentPrice: result.currentPrice };
}
