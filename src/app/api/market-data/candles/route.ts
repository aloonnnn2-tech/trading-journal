import { NextResponse } from "next/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { fetchYahooCandles, type Candle } from "@/lib/market-data/yahoo";
import { rateLimit } from "@/lib/rate-limit";

// This route makes an outbound request to Yahoo on every call, from this
// app's IP, with a symbol the caller chooses -- the same shape as the OCR and
// AI routes, which are both throttled. Without a limit here one signed-in
// client can loop it into sustained traffic against an unofficial,
// undocumented endpoint and get this app's IP throttled or blocked for
// everyone. Charts refetch on navigation and ticker changes, so the ceiling
// is set well above browsing that never sits still.
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

export type { Candle };

export interface CandlesResponse {
  candles: Candle[];
  currentPrice: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  /** ISO string over the wire -- Date doesn't survive JSON. */
  quoteTime: string | null;
}

export async function GET(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = rateLimit(`candles:${userId}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many price lookups — give it a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker")?.trim().toUpperCase();
  if (!ticker) {
    return NextResponse.json({ error: "Missing ticker" }, { status: 400 });
  }

  let result: Awaited<ReturnType<typeof fetchYahooCandles>>;
  try {
    result = await fetchYahooCandles(ticker);
  } catch {
    result = null;
  }

  if (!result || result.candles.length === 0) {
    return NextResponse.json({ error: "No price history for this symbol" }, { status: 404 });
  }

  const body: CandlesResponse = {
    candles: result.candles,
    currentPrice: result.currentPrice,
    dayHigh: result.dayHigh,
    dayLow: result.dayLow,
    quoteTime: result.quoteTime ? result.quoteTime.toISOString() : null,
  };
  return NextResponse.json(body);
}
