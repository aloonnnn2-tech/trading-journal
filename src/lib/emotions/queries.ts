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
  // Newest by the trade's own date, not by when it was logged, and read
  // generously: it used to take the 25 newest trades and THEN drop those
  // without emotions, so the list came up short (or empty) for anyone who
  // logs emotions on some trades only.
  const { data, error } = await supabase
    .from("trades")
    .select("id, ticker, entry_date, dollar_pl, custom_fields")
    .order("entry_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(Math.max(limit * 8, 200));

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
    .filter((entry) => entry.before.length > 0 || entry.during.length > 0 || entry.after.length > 0 || entry.intensity !== null)
    .slice(0, limit);
}
