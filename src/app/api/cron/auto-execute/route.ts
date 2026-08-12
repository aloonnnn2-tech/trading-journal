import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchDayRange, guessYahooSymbol } from "@/lib/market-data/yahoo";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import {
  decideAutoExecution,
  describeAutoExecution,
  isWatchable,
  type AutoExecutableTrade,
} from "@/lib/trades/auto-execute";
import { computeDerivedFields } from "@/lib/trades/compute";
import { resultFromPL } from "@/lib/trades/result";
import { listCommissionRules } from "@/lib/commissions/queries";
import { resolveCommission } from "@/lib/commissions/calculate";
import type { Trade, TradeCoreFields } from "@/lib/trades/types";

// Uses the Node runtime for `node:crypto` (timing-safe secret comparison)
// and because a sweep can outrun the Edge runtime's limits.
export const runtime = "nodejs";
// Never cache: each run must read current trades and live prices.
export const dynamic = "force-dynamic";

/** How many distinct tickers to price at once. Yahoo's endpoint is
 *  unofficial and undocumented on rate limits, so this stays modest. */
const PRICE_CONCURRENCY = 5;

/** How many trade updates to run at once. Sequential awaits made a large
 *  sweep linger; unbounded parallelism would hammer PostgREST instead. */
const UPDATE_CONCURRENCY = 10;

interface WatchedTrade extends AutoExecutableTrade {
  id: string;
  user_id: string;
  ticker: string;
  asset_type: string | null;
  market: string | null;
  exit_price: number | null;
  shares: number | null;
  risk_amount: number | null;
  commission: number | null;
  commission_manual: boolean;
}

/** Constant-time compare so the secret can't be recovered by timing. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authorize(request: Request): { ok: true } | { ok: false; status: number; error: string } {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // Fail closed. An unset secret must never mean "open to everyone" --
    // this endpoint can modify every user's trades.
    return { ok: false, status: 503, error: "CRON_SECRET is not configured" };
  }

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!provided || !secretMatches(provided, expected)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true };
}

/**
 * Sweeps every user's watchable trades and advances any whose price levels
 * have been touched — the background counterpart to the in-browser
 * `useAutoExecuteTrade` hook, which only runs while a trade's page is open.
 * Both call the same `decideAutoExecution`, so a trade advances identically
 * whichever notices first.
 *
 * Triggered by a Netlify scheduled function (see netlify/functions/) with a
 * shared secret. Safe to run repeatedly: a trade that has already advanced
 * no longer satisfies `isWatchable`, so a re-run is a no-op.
 */
export async function POST(request: Request) {
  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // `?dryRun=1` reports exactly what would change without writing anything.
  // This endpoint mutates every user's trades at once, so there has to be a
  // way to inspect a sweep before letting it run -- verifying it by simply
  // running it means the verification *is* the mutation.
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";

  const startedAt = Date.now();
  const supabase = createAdminClient();

  // Only the columns the decision and the P&L recompute need. fetchAllRows:
  // the silent 1,000-row page cap would otherwise mean some users' pending
  // orders are simply never watched, with nothing anywhere saying so.
  let data: WatchedTrade[];
  try {
    data = await fetchAllRows<WatchedTrade>((from, to) =>
      supabase
        .from("trades")
        .select(
          "id, user_id, mode, ticker, asset_type, market, status, direction, entry_price, exit_price, stop_loss, take_profit, shares, risk_amount, entry_date, commission, commission_manual",
        )
        .in("status", ["pending", "open"])
        .eq("mode", "trade")
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (error) {
    const message = (error as { message?: string }).message ?? "unknown";
    return NextResponse.json({ error: `Could not load trades: ${message}` }, { status: 500 });
  }

  const watched = data.filter((trade) => isWatchable(trade) && trade.ticker.trim() !== "");

  if (watched.length === 0) {
    return NextResponse.json({ dryRun, scanned: 0, executed: 0, tickers: 0, failures: [], ms: Date.now() - startedAt });
  }

  // Resolve to Yahoo's symbol form the same way the chart does (crypto
  // needs "BTC-USD", not "BTCUSD"), then one lookup per distinct symbol
  // rather than per trade -- several users watching AAPL is one request.
  const symbolFor = (t: WatchedTrade) => guessYahooSymbol(t.ticker, t.asset_type);
  const symbols = [...new Set(watched.map(symbolFor).filter(Boolean))];
  const prices = new Map<string, { dayHigh: number | null; dayLow: number | null; quoteTime: Date | null }>();
  const failures: string[] = [];

  for (let i = 0; i < symbols.length; i += PRICE_CONCURRENCY) {
    const batch = symbols.slice(i, i + PRICE_CONCURRENCY);
    await Promise.all(
      batch.map(async (symbol) => {
        try {
          const range = await fetchDayRange(symbol);
          if (range) prices.set(symbol, range);
          else failures.push(`${symbol}: no price data`);
        } catch (err) {
          failures.push(`${symbol}: ${(err as Error).message}`);
        }
      }),
    );
  }

  // Commission rules are per-user and this client bypasses RLS, so they're
  // loaded per user id and cached for the sweep.
  const rulesByUser = new Map<string, Awaited<ReturnType<typeof listCommissionRules>>>();
  async function rulesFor(userId: string) {
    const cached = rulesByUser.get(userId);
    if (cached) return cached;
    const rules = await listCommissionRules(supabase, userId);
    rulesByUser.set(userId, rules);
    return rules;
  }

  const executed: { id: string; ticker: string; message: string }[] = [];
  const now = new Date();

  // Decide first (pure, cheap), then write in bounded-concurrency chunks --
  // a sweep with many triggers shouldn't serialize one DB round trip per
  // trade, and the decisions don't depend on each other.
  const triggered: { trade: WatchedTrade; decision: NonNullable<ReturnType<typeof decideAutoExecution>> }[] = [];
  for (const trade of watched) {
    const levels = prices.get(symbolFor(trade));
    if (!levels) continue;
    const decision = decideAutoExecution(trade, levels, now);
    if (decision) triggered.push({ trade, decision });
  }

  for (let i = 0; i < triggered.length; i += UPDATE_CONCURRENCY) {
    const batch = triggered.slice(i, i + UPDATE_CONCURRENCY);
    await Promise.all(
      batch.map(async ({ trade, decision }) => {
       // One trade must not take the sweep down with it. rulesFor() is a
       // live Supabase read, and a throw from it rejected the whole
       // Promise.all: the route 500'd, every remaining batch was abandoned,
       // and the report of the trades already written was thrown away with
       // it -- writes that had really happened, with nothing left saying so.
       // Failures are collected per trade, the same as an update error.
       try {
        // Apply the same derived-field pipeline a normal edit goes through,
        // so an auto-closed trade lands with correct commission and net P&L
        // rather than a status change alone.
        const merged = { ...trade, ...decision.changes } as unknown as Trade;
        const commission = trade.commission_manual
          ? trade.commission
          : resolveCommission(await rulesFor(trade.user_id), {
              mode: merged.mode,
              asset_type: merged.asset_type,
              market: merged.market,
              status: merged.status,
              direction: merged.direction,
              entry_price: merged.entry_price,
              exit_price: merged.exit_price,
              shares: merged.shares,
            });

        const derived = computeDerivedFields({
          ...(merged as unknown as TradeCoreFields),
          commission,
        });

        // Result is derived from the commission-net dollar_pl computed just
        // above, not assumed from which level was touched -- a thin
        // take-profit margin can still net a loss once commission lands.
        //
        // The null case matters here: nothing requires a watched trade to
        // carry a share count, so dollar_pl can come back null, and
        // resultFromPL answers "open" for that -- a truthy value that then
        // got written next to status: "closed", which the trades list shows
        // as two contradictory badges. A finished trade whose P/L can't be
        // computed is recorded as break-even instead.
        const result =
          merged.status !== "closed"
            ? undefined
            : derived.dollar_pl == null
              ? "break_even"
              : resultFromPL(derived.dollar_pl);

        if (!dryRun) {
          const { error: updateError } = await supabase
            .from("trades")
            .update({ ...decision.changes, ...(result ? { result } : {}), commission, ...derived })
            .eq("id", trade.id)
            // Scoped by user_id as well as id: RLS is off on this client, so
            // the filter that normally guarantees ownership must be explicit.
            .eq("user_id", trade.user_id);

          if (updateError) {
            failures.push(`${trade.ticker} (${trade.id}): ${updateError.message}`);
            return;
          }
        }
        executed.push({ id: trade.id, ticker: trade.ticker, message: describeAutoExecution(decision) });
       } catch (error) {
         failures.push(
           `${trade.ticker} (${trade.id}): ${error instanceof Error ? error.message : String(error)}`,
         );
       }
      }),
    );
  }

  return NextResponse.json({
    dryRun,
    scanned: watched.length,
    tickers: symbols.length,
    executed: executed.length,
    details: executed,
    failures,
    ms: Date.now() - startedAt,
  });
}
