import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParseResult } from "./types";

/**
 * Trades already in the journal that look like the one just read: same
 * ticker, and the same entry price and share count when those were read.
 * The review screen warns; it never blocks or merges -- the user decides.
 * Uses the caller's RLS client, so only their own trades can match.
 */
export async function findPossibleDuplicates(
  supabase: SupabaseClient,
  result: Pick<ParseResult, "core">,
): Promise<NonNullable<ParseResult["duplicates"]>> {
  const ticker = result.core.ticker?.value;
  if (typeof ticker !== "string" || !ticker.trim()) return [];

  let query = supabase
    .from("trades")
    .select("id, entry_date, status")
    .eq("ticker", ticker.trim().toUpperCase())
    .order("created_at", { ascending: false })
    .limit(3);
  const entry = result.core.entry_price?.value;
  const shares = result.core.shares?.value;
  if (typeof entry === "number") query = query.eq("entry_price", entry);
  if (typeof shares === "number") query = query.eq("shares", shares);
  // Ticker alone matches every trade in that symbol -- not a duplicate.
  if (typeof entry !== "number" && typeof shares !== "number") return [];

  const { data, error } = await query;
  if (error || !data) return [];
  return data.map((t) => ({ id: t.id as string, entryDate: (t.entry_date as string | null) ?? null, status: String(t.status) }));
}

/**
 * One log line per screenshot read, for spotting accuracy problems: which
 * checks failed on which fields, which fields were only suggestions, and the
 * detected broker. Never the image, the text, or any value read from it.
 */
export function accuracyLogLine(result: ParseResult): Record<string, unknown> {
  return {
    broker: result.broker,
    screenshotType: result.screenshotType,
    filled: Object.entries(result.core)
      .filter(([, f]) => f && !f.heuristic && f.confidence >= 0.55)
      .map(([k]) => k),
    suggested: Object.entries(result.core)
      .filter(([, f]) => f && (f.heuristic || f.confidence < 0.55))
      .map(([k]) => k),
    failedChecks: result.log.validation.filter((v) => !v.ok).map((v) => v.field),
    warnings: result.warnings.length,
  };
}
