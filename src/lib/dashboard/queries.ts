import type { SupabaseClient } from "@supabase/supabase-js";
import type { Trade } from "@/lib/trades/types";

// "Today" and "this month" are computed in UTC day boundaries -- good
// enough for now; per-user timezone preference is a future-expansion
// concern, not a Milestone 4 one.
function startOfUtcDay(date: Date): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

export async function getTodayPL(supabase: SupabaseClient): Promise<number> {
  const now = new Date();
  const todayStart = startOfUtcDay(now);
  const tomorrowStart = startOfUtcDay(new Date(now.getTime() + 24 * 60 * 60 * 1000));

  const { data, error } = await supabase
    .from("trades")
    .select("dollar_pl")
    .gte("exit_date", todayStart)
    .lt("exit_date", tomorrowStart);

  if (error) throw error;
  return data.reduce((sum, row) => sum + (row.dollar_pl ?? 0), 0);
}

export async function getWinRate(
  supabase: SupabaseClient,
): Promise<{ wins: number; closedTotal: number; rate: number | null }> {
  const base = () => supabase.from("trades").select("*", { count: "exact", head: true }).eq("status", "closed");

  const [closedTotal, wins] = await Promise.all([base(), base().eq("result", "win")]);

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
): Promise<DailyPL[]> {
  const monthStart = new Date(Date.UTC(year, month, 1)).toISOString();
  const monthEnd = new Date(Date.UTC(year, month + 1, 1)).toISOString();

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
    const day = new Date(row.exit_date).getUTCDate();
    byDay.set(day, (byDay.get(day) ?? 0) + (row.dollar_pl ?? 0));
  }

  return Array.from(byDay.entries()).map(([day, dollar_pl]) => ({ day, dollar_pl }));
}

const STRATEGY_TAG_KEY = "strategy_setup";

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
    .select("dollar_pl, custom_fields")
    .eq("status", "closed");
  if (error) throw error;

  const rows = data as { dollar_pl: number | null; custom_fields: Record<string, unknown> }[];
  const byTag = new Map<string, { trades: number; wins: number; totalPL: number }>();

  for (const row of rows) {
    const pl = row.dollar_pl ?? 0;
    const tagsRaw = row.custom_fields?.[STRATEGY_TAG_KEY];
    const tags = Array.isArray(tagsRaw) ? (tagsRaw.filter((t) => typeof t === "string") as string[]) : [];
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
