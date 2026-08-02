import { NextResponse } from "next/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { fetchYahooCandles, type Candle } from "@/lib/market-data/yahoo";

export type { Candle };

export interface CandlesResponse {
  candles: Candle[];
  currentPrice: number | null;
  dayHigh: number | null;
  dayLow: number | null;
}

export async function GET(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
  };
  return NextResponse.json(body);
}
