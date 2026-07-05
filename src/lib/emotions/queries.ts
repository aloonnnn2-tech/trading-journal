import type { SupabaseClient } from "@supabase/supabase-js";

const EMOTION_KEYS = {
  before: "emotion_before",
  during: "emotion_during",
  after: "emotion_after",
  intensity: "emotion_intensity",
} as const;

export interface EmotionHistoryEntry {
  tradeId: string;
  ticker: string;
  date: string | null;
  before: string[];
  during: string[];
  after: string[];
  intensity: number | null;
  dollarPL: number | null;
}

export interface EmotionBreakdown {
  emotion: string;
  trades: number;
  wins: number;
  winRate: number | null;
  totalPL: number;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? (value.filter((v) => typeof v === "string") as string[]) : [];
}

// Most recent trades carrying any emotion data, for the emotion history
// view. Limited the same way getRecentTrades is on the dashboard -- this
// is a feed, not a full export.
export async function getEmotionHistory(
  supabase: SupabaseClient,
  limit = 25,
): Promise<EmotionHistoryEntry[]> {
  const { data, error } = await supabase
    .from("trades")
    .select("id, ticker, entry_date, dollar_pl, custom_fields")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  const rows = data as {
    id: string;
    ticker: string;
    entry_date: string | null;
    dollar_pl: number | null;
    custom_fields: Record<string, unknown>;
  }[];

  return rows
    .map((row) => ({
      tradeId: row.id,
      ticker: row.ticker,
      date: row.entry_date,
      before: asStringArray(row.custom_fields?.[EMOTION_KEYS.before]),
      during: asStringArray(row.custom_fields?.[EMOTION_KEYS.during]),
      after: asStringArray(row.custom_fields?.[EMOTION_KEYS.after]),
      intensity: typeof row.custom_fields?.[EMOTION_KEYS.intensity] === "number"
        ? (row.custom_fields[EMOTION_KEYS.intensity] as number)
        : null,
      dollarPL: row.dollar_pl,
    }))
    .filter((entry) => entry.before.length > 0 || entry.during.length > 0 || entry.after.length > 0 || entry.intensity !== null);
}

// Win rate / P/L broken down by "emotion before trade" value, across all
// closed trades -- the data Pattern Recognition (Milestone 4) needs to
// flag emotion-linked patterns, and also useful as its own view.
export async function getEmotionBreakdown(supabase: SupabaseClient): Promise<EmotionBreakdown[]> {
  const { data, error } = await supabase
    .from("trades")
    .select("dollar_pl, custom_fields")
    .eq("status", "closed");

  if (error) throw error;

  const rows = data as { dollar_pl: number | null; custom_fields: Record<string, unknown> }[];
  const byEmotion = new Map<string, { trades: number; wins: number; totalPL: number }>();

  for (const row of rows) {
    const pl = row.dollar_pl ?? 0;
    const emotions = asStringArray(row.custom_fields?.[EMOTION_KEYS.before]);
    for (const emotion of emotions) {
      const bucket = byEmotion.get(emotion) ?? { trades: 0, wins: 0, totalPL: 0 };
      bucket.trades += 1;
      if (pl > 0) bucket.wins += 1;
      bucket.totalPL += pl;
      byEmotion.set(emotion, bucket);
    }
  }

  return Array.from(byEmotion.entries())
    .map(([emotion, stats]) => ({
      emotion,
      trades: stats.trades,
      wins: stats.wins,
      winRate: stats.trades > 0 ? stats.wins / stats.trades : null,
      totalPL: stats.totalPL,
    }))
    .sort((a, b) => b.trades - a.trades);
}
