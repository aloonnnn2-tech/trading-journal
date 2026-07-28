import { getMissingFields } from "./missing-fields";
import { localDateParts } from "@/lib/dates/local-day";
import type { EditableCoreField, Trade } from "./types";

// The minimal per-trade shape the streak calc reads -- same fields
// getMissingFields() checks, plus id/mode/created_at for grouping. A
// subset of Trade rather than the full row (no custom_fields/notes).
export type StreakTrade = Pick<
  Trade,
  | "id"
  | "mode"
  | "status"
  | "created_at"
  | "ticker"
  | "direction"
  | "entry_price"
  | "exit_price"
  | "stop_loss"
  | "entry_date"
  | "exit_date"
  | "dollar_amount"
  | "shares"
  | "position_size"
>;

interface DayParts {
  year: number;
  month: number; // 0-indexed
  day: number;
}

function dayKeyOf(p: DayParts): string {
  return `${p.year}-${String(p.month + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

// Pure calendar-day arithmetic on a {year, month, day} triplet -- not tied
// to any real timezone/instant, just using Date.UTC as a day-rollover
// calculator (handles month/year boundaries for free).
function previousDay(p: DayParts): DayParts {
  const d = new Date(Date.UTC(p.year, p.month, p.day - 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

/**
 * "Needs attention" streak: consecutive local calendar days with at least
 * one trade (by created_at) that currently has zero missing required
 * fields per getMissingFields() -- i.e. the checklist showed "0 to fill"
 * for that day.
 *
 * Streak-reset rule (unspecified upstream, stated here per the brief): a
 * day with zero trades, or a day where every trade still has something
 * missing, breaks the streak -- the spec is "days with at least one fully
 * filled trade," and an empty day trivially fails that. Today itself is
 * never treated as a *break* while it's still in progress, though: if
 * today hasn't produced a qualifying trade yet, the count simply starts
 * from yesterday rather than resetting to zero (Duolingo-style -- a
 * streak dies at the end of an unqualifying day, not the moment one
 * starts), so the badge doesn't read "streak broken" first thing in the
 * morning before the user has logged anything.
 *
 * Because "qualifies" is evaluated against each trade's *current* field
 * state (no historical snapshot table -- this stays client-derivable, per
 * the brief's no-new-table constraint), editing an old trade to complete
 * it later can retroactively fix that day's streak. Accepted tradeoff of
 * not adding a new table for this.
 */
export function computeAttentionStreak(
  trades: StreakTrade[],
  hiddenCoreFields: EditableCoreField[],
  timezone: string | null,
  now: Date = new Date(),
): number {
  const byDay = new Map<string, StreakTrade[]>();
  for (const trade of trades) {
    const key = dayKeyOf(localDateParts(new Date(trade.created_at), timezone));
    (byDay.get(key) ?? byDay.set(key, []).get(key)!).push(trade);
  }

  const qualifies = (key: string): boolean => {
    const dayTrades = byDay.get(key);
    if (!dayTrades || dayTrades.length === 0) return false;
    return dayTrades.some(
      (trade) => getMissingFields(trade as Trade, trade.mode === "investment", hiddenCoreFields).length === 0,
    );
  };

  let cursor = localDateParts(now, timezone);
  let streak = 0;
  if (qualifies(dayKeyOf(cursor))) streak = 1;

  cursor = previousDay(cursor);
  while (qualifies(dayKeyOf(cursor))) {
    streak += 1;
    cursor = previousDay(cursor);
  }

  return streak;
}
