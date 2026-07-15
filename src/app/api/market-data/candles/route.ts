import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export interface Candle {
  time: string; // "YYYY-MM-DD"
  open: number;
  high: number;
  low: number;
  close: number;
}

// Yahoo Finance's undocumented chart endpoint -- no API key required, but
// it's unofficial and could change or start rate-limiting without notice.
// Only covers listed equities/ETFs/indices/major crypto pairs by their
// plain ticker, not forex pairs, so callers should skip requesting a
// symbol they know is forex.
async function fetchYahooCandles(symbol: string): Promise<Candle[] | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=6mo&interval=1d`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    next: { revalidate: 300 },
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
  return candles;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker")?.trim().toUpperCase();
  if (!ticker) {
    return NextResponse.json({ error: "Missing ticker" }, { status: 400 });
  }

  let candles: Candle[] | null;
  try {
    candles = await fetchYahooCandles(ticker);
  } catch {
    candles = null;
  }

  if (!candles || candles.length === 0) {
    return NextResponse.json({ error: "No price history for this symbol" }, { status: 404 });
  }

  return NextResponse.json({ candles });
}
