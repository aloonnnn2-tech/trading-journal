/**
 * Guards the one piece of logic that exists twice: the dashboard's
 * aggregates live in SQL (the dashboard_stats RPC, migrations 0020/0021)
 * AND in JS (the fallback path in src/lib). They have drifted once already
 * -- committed cash disagreed by $24,212.50 between the dashboard and
 * position-size prefill because a fix landed in JS but the RPC migration
 * hadn't been applied. This script compares every value the RPC returns
 * against its JS equivalent and fails loudly on any mismatch.
 *
 * Run it after changing either side, and after applying any migration that
 * touches dashboard_stats:
 *
 *   TJ_TEST_EMAIL=... TJ_TEST_PASSWORD=... npx tsx --env-file=.env.local scripts/check-rpc-parity.ts
 *
 * Credentials come from the environment on purpose -- this repo is public,
 * so they must never be committed. Use the demo/test account, never a real
 * user's. The script only reads; it writes nothing.
 */
import { createClient } from "@supabase/supabase-js";
import { getStatusCounts } from "../src/lib/trades/queries";
import { getWinRate, getBestWorstSetup, getTodayPL, getMonthlyPL } from "../src/lib/dashboard/queries";
import { getAccountBalance } from "../src/lib/account/queries";
import { localDateParts, startOfLocalDayIso } from "../src/lib/dates/local-day";

async function main() {
  const email = process.env.TJ_TEST_EMAIL;
  const password = process.env.TJ_TEST_PASSWORD;
  if (!email || !password) {
    console.error(
      "Set TJ_TEST_EMAIL and TJ_TEST_PASSWORD (the demo account) in the environment.\n" +
        "They are intentionally not stored in this public repo.",
    );
    process.exit(2);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
  if (authError) {
    console.error("Sign-in failed:", authError.message);
    process.exit(2);
  }

  const tz = "UTC";
  const now = new Date();
  const { year, month, day } = localDateParts(now, tz);

  const { data, error } = await supabase.rpc("dashboard_stats", {
    p_today_start: startOfLocalDayIso(year, month, day, tz),
    p_today_end: startOfLocalDayIso(year, month, day + 1, tz),
    p_month_start: startOfLocalDayIso(year, month, 1, tz),
    p_month_end: startOfLocalDayIso(year, month + 1, 1, tz),
    p_timezone: tz,
  });
  if (error) {
    console.error("RPC failed:", error.code, error.message);
    process.exit(1);
  }
  const rpc = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;

  // The same numbers, computed the other way (the JS fallback path).
  const [counts, winRate, todayPL, monthlyPL, setups, balance] = await Promise.all([
    getStatusCounts(supabase),
    getWinRate(supabase),
    getTodayPL(supabase, tz),
    getMonthlyPL(supabase, year, month, tz),
    getBestWorstSetup(supabase),
    getAccountBalance(supabase),
  ]);

  const checks: [string, unknown, unknown][] = [
    ["status_all", Number(rpc.status_all), counts.all],
    ["status_pending", Number(rpc.status_pending), counts.pending],
    ["status_open", Number(rpc.status_open), counts.open],
    ["status_closed", Number(rpc.status_closed), counts.closed],
    ["closed_total", Number(rpc.closed_total), winRate.closedTotal],
    ["wins", Number(rpc.wins), winRate.wins],
    ["today_pl", Number(rpc.today_pl).toFixed(6), todayPL.toFixed(6)],
    ["deposited", Number(rpc.deposited).toFixed(6), balance.deposited.toFixed(6)],
    ["trade_pl", Number(rpc.trade_pl).toFixed(6), balance.tradePL.toFixed(6)],
    ["committed_cash", Number(rpc.committed_cash).toFixed(6), balance.committedCash.toFixed(6)],
    ["has_transactions", Boolean(rpc.has_transactions), balance.hasTransactions],
    ["monthly_pl day-count", ((rpc.monthly_pl as unknown[]) ?? []).length, monthlyPL.length],
    ["best_setup tag", (rpc.best_setup as { tag?: string } | null)?.tag ?? null, setups.best?.tag ?? null],
    ["worst_setup tag", (rpc.worst_setup as { tag?: string } | null)?.tag ?? null, setups.worst?.tag ?? null],
  ];

  let drift = 0;
  for (const [name, fromRpc, fromJs] of checks) {
    if (String(fromRpc) !== String(fromJs)) {
      drift += 1;
      console.error(`DRIFT ${name}: rpc=${String(fromRpc)} js=${String(fromJs)}`);
    }
  }

  if (drift > 0) {
    console.error(`\n${drift} value(s) drifted — the SQL and JS implementations disagree.`);
    process.exit(1);
  }
  console.log(`all ${checks.length} values agree between the RPC and the JS fallback`);
}

main();
