import type { SupabaseClient } from "@supabase/supabase-js";
import type { Trade } from "@/lib/trades/types";
import { getLocalDayOfMonth, localDateParts, startOfLocalDayIso } from "@/lib/dates/local-day";
import { getStatusCounts } from "@/lib/trades/queries";
import { getAccountBalance, type AccountBalance } from "@/lib/account/queries";

// "Today" and "this month" are bucketed by the user's own calendar day, not
// UTC's -- see src/lib/dates/local-day.ts for why that distinction matters
// here. `timezone` is null until the client has reported one, in which case
// these fall back to UTC exactly as they always did.
export async function getTodayPL(
  supabase: SupabaseClient,
  timezone: string | null = null,
): Promise<number> {
  const { year, month, day } = localDateParts(new Date(), timezone);
  const todayStart = startOfLocalDayIso(year, month, day, timezone);
  const tomorrowStart = startOfLocalDayIso(year, month, day + 1, timezone);

  const { data, error } = await supabase
    .from("trades")
    .select("dollar_pl")
    .eq("status", "closed")
    .gte("exit_date", todayStart)
    .lt("exit_date", tomorrowStart);

  if (error) throw error;
  return data.reduce((sum, row) => sum + (row.dollar_pl ?? 0), 0);
}

export async function getWinRate(
  supabase: SupabaseClient,
): Promise<{ wins: number; closedTotal: number; rate: number | null }> {
  // Defined by dollar_pl > 0, not the result column, to match every other
  // win-rate calculation in the app (analytics/insights/ask queries, and
  // this same file's own getBestWorstSetup) -- result is user-set and can
  // drift from the computed P/L (e.g. marked "win" before entry/exit
  // prices are filled in), which previously made this the one place in
  // the app showing a different win rate for the same trades.
  //
  // The `exit_date is not null` filter matters for the same reason: the
  // analytics, insights, and ask pages all restrict their closed-trade set
  // that way, so without it a closed trade with no exit date sat in this
  // denominator but nobody else's, and the dashboard reported a different
  // win rate from /analytics for the exact same history.
  const base = () =>
    supabase
      .from("trades")
      .select("*", { count: "exact", head: true })
      .eq("status", "closed")
      .not("exit_date", "is", null);

  const [closedTotal, wins] = await Promise.all([base(), base().gt("dollar_pl", 0)]);

  const total = closedTotal.count ?? 0;
  const winCount = wins.count ?? 0;
  return { wins: winCount, closedTotal: total, rate: total > 0 ? winCount / total : null };
}

export async function getRecentTrades(supabase: SupabaseClient, limit = 5): Promise<Trade[]> {
  const { data, error } = await supabase
    .from("trades")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data as Trade[];
}

export interface PerformancePoint {
  date: string;
  dollar_pl: number;
  cumulative: number;
}

// Cumulative P/L over the last `limit` closed trades, for the dashboard
// performance graph. Bounded by `limit` rather than fetching every
// closed trade, so this stays cheap at 100k+ trades.
export async function getPerformanceSeries(
  supabase: SupabaseClient,
  limit = 200,
): Promise<PerformancePoint[]> {
  const { data, error } = await supabase
    .from("trades")
    .select("exit_date, dollar_pl")
    .eq("status", "closed")
    .not("exit_date", "is", null)
    .order("exit_date", { ascending: false })
    .limit(limit);

  if (error) throw error;

  const ascending = [...data].reverse();
  let cumulative = 0;
  return ascending.map((row) => {
    cumulative += row.dollar_pl ?? 0;
    return { date: row.exit_date as string, dollar_pl: row.dollar_pl ?? 0, cumulative };
  });
}

export interface DailyPL {
  day: number;
  dollar_pl: number;
}

export async function getMonthlyPL(
  supabase: SupabaseClient,
  year: number,
  month: number, // 0-indexed, matches JS Date
  timezone: string | null = null,
): Promise<DailyPL[]> {
  const monthStart = startOfLocalDayIso(year, month, 1, timezone);
  const monthEnd = startOfLocalDayIso(year, month + 1, 1, timezone);

  const { data, error } = await supabase
    .from("trades")
    .select("exit_date, dollar_pl")
    .eq("status", "closed")
    .gte("exit_date", monthStart)
    .lt("exit_date", monthEnd);

  if (error) throw error;

  const byDay = new Map<number, number>();
  for (const row of data) {
    if (!row.exit_date) continue;
    const day = getLocalDayOfMonth(row.exit_date as string, timezone);
    byDay.set(day, (byDay.get(day) ?? 0) + (row.dollar_pl ?? 0));
  }

  return Array.from(byDay.entries()).map(([day, dollar_pl]) => ({ day, dollar_pl }));
}

export interface SetupStats {
  tag: string;
  trades: number;
  winRate: number | null;
  totalPL: number;
}

// Best/worst by total P/L (not win rate alone) so a 100%-win, 1-trade
// setup doesn't outrank a consistently profitable one with real sample
// size -- same byTag shape as the analytics module, just ranked here
// instead of listed in full.
export async function getBestWorstSetup(
  supabase: SupabaseClient,
): Promise<{ best: SetupStats | null; worst: SetupStats | null }> {
  const { data, error } = await supabase
    .from("trades")
    .select("dollar_pl, trade_strategies(strategies(name))")
    .eq("status", "closed");
  if (error) throw error;

  const rows = data as {
    dollar_pl: number | null;
    trade_strategies: { strategies: { name: string }[] }[];
  }[];
  const byTag = new Map<string, { trades: number; wins: number; totalPL: number }>();

  for (const row of rows) {
    const pl = row.dollar_pl ?? 0;
    const tags = row.trade_strategies
      .flatMap((link) => link.strategies)
      .map((s) => s?.name)
      .filter((name): name is string => typeof name === "string");
    for (const tag of tags) {
      const bucket = byTag.get(tag) ?? { trades: 0, wins: 0, totalPL: 0 };
      bucket.trades += 1;
      if (pl > 0) bucket.wins += 1;
      bucket.totalPL += pl;
      byTag.set(tag, bucket);
    }
  }

  const stats: SetupStats[] = Array.from(byTag.entries()).map(([tag, s]) => ({
    tag,
    trades: s.trades,
    winRate: s.trades > 0 ? s.wins / s.trades : null,
    totalPL: s.totalPL,
  }));

  if (stats.length === 0) return { best: null, worst: null };

  const best = stats.reduce((a, b) => (b.totalPL > a.totalPL ? b : a));
  const worst = stats.reduce((a, b) => (b.totalPL < a.totalPL ? b : a));
  return { best, worst: worst.tag === best.tag && stats.length === 1 ? null : worst };
}

export interface DashboardStats {
  counts: { all: number; pending: number; open: number; closed: number };
  winRate: { wins: number; closedTotal: number; rate: number | null };
  todayPL: number;
  monthlyPL: DailyPL[];
  bestWorstSetup: { best: SetupStats | null; worst: SetupStats | null };
  accountBalance: AccountBalance;
}

// PERF-2: the six count/aggregate query groups above (status counts, win
// rate, today's/monthly P/L, best/worst setup, account balance) collapse
// into one `dashboard_stats` RPC call (see
// supabase/migrations/0020_dashboard_stats_rpc.sql). Falls back to the
// original per-query path on *any* RPC error -- not just PGRST202
// ("could not find the function," the not-yet-migrated case) -- so a bug
// in the SQL itself (caught live during this session: an ambiguous-column
// error from CTE columns shadowing the function's own OUT parameter names)
// degrades to a working dashboard instead of a 500, the same way a missing
// migration does. Logged, not swallowed silently, so a real regression is
// still visible in server logs.

function setupFromJson(raw: unknown): SetupStats | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { tag: string; trades: number; wins: number; totalPL: number };
  return {
    tag: row.tag,
    trades: row.trades,
    winRate: row.trades > 0 ? row.wins / row.trades : null,
    totalPL: row.totalPL,
  };
}

export async function getDashboardStats(
  supabase: SupabaseClient,
  timezone: string | null,
): Promise<DashboardStats> {
  const now = new Date();
  const { year, month, day } = localDateParts(now, timezone);
  const tz = timezone ?? "UTC";

  const { data, error } = await supabase.rpc("dashboard_stats", {
    p_today_start: startOfLocalDayIso(year, month, day, timezone),
    p_today_end: startOfLocalDayIso(year, month, day + 1, timezone),
    p_month_start: startOfLocalDayIso(year, month, 1, timezone),
    p_month_end: startOfLocalDayIso(year, month + 1, 1, timezone),
    p_timezone: tz,
  });

  if (error) {
    console.error("dashboard_stats RPC failed, falling back to per-query path:", error);
  }

  if (!error && data) {
    const row = Array.isArray(data) ? data[0] : data;
    const closedTotal = Number(row.closed_total ?? 0);
    const wins = Number(row.wins ?? 0);
    const deposited = Number(row.deposited ?? 0);
    const tradePL = Number(row.trade_pl ?? 0);
    const balance = deposited + tradePL;
    const committedCash = Number(row.committed_cash ?? 0);

    return {
      counts: {
        all: Number(row.status_all ?? 0),
        pending: Number(row.status_pending ?? 0),
        open: Number(row.status_open ?? 0),
        closed: Number(row.status_closed ?? 0),
      },
      winRate: { wins, closedTotal, rate: closedTotal > 0 ? wins / closedTotal : null },
      todayPL: Number(row.today_pl ?? 0),
      monthlyPL: ((row.monthly_pl as { day: number; dollar_pl: number }[] | null) ?? []).map(
        (r) => ({ day: r.day, dollar_pl: Number(r.dollar_pl) }),
      ),
      bestWorstSetup: {
        best: setupFromJson(row.best_setup),
        worst: setupFromJson(row.worst_setup),
      },
      accountBalance: {
        deposited,
        tradePL,
        balance,
        committedCash,
        availableCash: balance - committedCash,
        hasTransactions: Boolean(row.has_transactions),
      },
    };
  }

  // Migration not applied yet -- fall back to the original per-query path.
  const [counts, winRate, todayPL, monthlyPL, bestWorstSetup, accountBalance] = await Promise.all([
    getStatusCounts(supabase),
    getWinRate(supabase),
    getTodayPL(supabase, timezone),
    getMonthlyPL(supabase, year, month, timezone),
    getBestWorstSetup(supabase),
    getAccountBalance(supabase),
  ]);

  return { counts, winRate, todayPL, monthlyPL, bestWorstSetup, accountBalance };
}

const NOTE_FIELD_LABELS: Record<string, string> = {
  notes_why_entered: "Why did I take this trade?",
  notes_what_right: "What did I do right?",
  notes_what_change: "What would I change?",
  notes_lessons_learned: "Lessons Learned",
  notes_additional: "Additional Notes",
};

export interface RecentNote {
  tradeId: string;
  ticker: string;
  date: string | null;
  label: string;
  text: string;
}

// Most recent non-empty note across all note fields, one per trade
// (whichever note field on that trade was filled in most "meaningfully" --
// here just the first non-empty one found in label order) -- a feed, not
// a full notes export.
export async function getRecentNotes(supabase: SupabaseClient, limit = 5): Promise<RecentNote[]> {
  const { data, error } = await supabase
    .from("trades")
    .select("id, ticker, entry_date, custom_fields")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;

  const rows = data as {
    id: string;
    ticker: string;
    entry_date: string | null;
    custom_fields: Record<string, unknown>;
  }[];

  const notes: RecentNote[] = [];
  for (const row of rows) {
    for (const key of Object.keys(NOTE_FIELD_LABELS)) {
      const value = row.custom_fields?.[key];
      if (typeof value === "string" && value.trim() !== "") {
        notes.push({
          tradeId: row.id,
          ticker: row.ticker,
          date: row.entry_date,
          label: NOTE_FIELD_LABELS[key],
          text: value,
        });
        break;
      }
    }
    if (notes.length >= limit) break;
  }

  return notes;
}
