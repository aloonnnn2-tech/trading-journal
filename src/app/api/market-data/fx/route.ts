import { NextResponse } from "next/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { fetchYahooCandles } from "@/lib/market-data/yahoo";
import { rateLimit } from "@/lib/rate-limit";
import { CURRENCIES } from "@/lib/commissions/fee-form";

// Today's rate for a fee stated in another currency: how many US dollars one
// unit of it is worth. Used once, when a fee is set up -- the rate is then
// stored on the fee with its date, so a trade's result never changes because
// the market moved afterwards. The user can overwrite it.
//
// Only the listed currencies: the symbol goes to Yahoo, so it is never taken
// from the request as free text.

export async function GET(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await rateLimit(`fx:${userId}`, 30, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many lookups — give it a moment." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const from = new URL(request.url).searchParams.get("from") ?? "";
  if (!(CURRENCIES as readonly string[]).includes(from)) {
    return NextResponse.json({ error: "Unknown currency" }, { status: 400 });
  }

  // EURUSD=X is USD per EUR -- exactly the rate a fee needs.
  const quote = await fetchYahooCandles(`${from}USD=X`, { range: "5d", revalidate: 3600 }).catch(() => null);
  const rate = quote?.currentPrice ?? quote?.candles.at(-1)?.close ?? null;
  if (rate == null || !Number.isFinite(rate) || rate <= 0) {
    return NextResponse.json({ error: "Couldn't fetch today's rate. Enter it yourself." }, { status: 503 });
  }
  return NextResponse.json({ from, to: "USD", rate: Number(rate.toFixed(6)), date: new Date().toISOString().slice(0, 10) });
}
