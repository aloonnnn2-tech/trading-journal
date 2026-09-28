import { NextResponse } from "next/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { fetchYahooBars, type YahooBarsResult } from "@/lib/market-data/yahoo";
import { rateLimit } from "@/lib/rate-limit";

// The trade chart's holding-period bars (Phase 4C): one bar size over one
// date range. The candles route next door still serves the two-year daily
// history for trades without dates and for the auto-execution price watch.
//
// Same outbound-request concern as that route, so the same limit -- and the
// SAME bucket: both call Yahoo from this app's IP, and what matters is the
// total a single user can drive, not each route's share of it.
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

const INTERVALS = ["5m", "60m", "1d"] as const;
type Interval = (typeof INTERVALS)[number];

/** Yahoo symbols: letters, digits and . - = ^ (e.g. BRK.B, BTC-USD, EURUSD=X, ^GSPC). */
const SYMBOL = /^[A-Z0-9.\-=^]{1,20}$/;

/** Ten years is far past anything a trade chart asks for. */
const MAX_SPAN_SECONDS = 10 * 366 * 86_400;

export type BarsResponse = YahooBarsResult & { interval: Interval };

export async function GET(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = await rateLimit(`candles:${userId}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many price lookups — give it a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker")?.trim().toUpperCase() ?? "";
  const interval = searchParams.get("interval") as Interval | null;
  const period1 = Number(searchParams.get("period1"));
  const period2 = Number(searchParams.get("period2"));

  if (
    !SYMBOL.test(ticker) ||
    !interval ||
    !INTERVALS.includes(interval) ||
    !Number.isInteger(period1) ||
    !Number.isInteger(period2) ||
    period1 < 0 ||
    period2 <= period1 ||
    period2 - period1 > MAX_SPAN_SECONDS
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  let result: YahooBarsResult | null;
  try {
    result = await fetchYahooBars(ticker, { interval, period1, period2 });
  } catch {
    result = null;
  }
  if (!result || result.bars.length === 0) {
    return NextResponse.json({ error: "No price history for this symbol and period" }, { status: 404 });
  }

  const body: BarsResponse = { ...result, interval };
  return NextResponse.json(body);
}
