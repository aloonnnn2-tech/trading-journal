// Pure predicates about how a trade was managed, as opposed to what it made.
//
// Extracted because both of these had already been written twice:
// `exitedBeforeTarget` in the AI trade-review and period-review prompts, and
// `holdingDays` in the trade-review prompt and the plan-rule evaluator. Two
// copies of a direction-aware comparison is one bug away from a short trade
// being reported as an early exit in one feature and a disciplined one in
// another, for the same row.

/** The trade fields these read. Kept minimal so any row shape satisfies it. */
export interface BehaviourInput {
  direction?: string | null;
  exit_price?: number | null;
  take_profit?: number | null;
  entry_date?: string | null;
  exit_date?: string | null;
}

/**
 * Did this exit fall short of the trade's own target?
 *
 * Null when it cannot be judged -- no exit, no target, or no direction
 * recorded. **Direction-aware**, because "short of the target" inverts: a
 * long's target sits above the entry, a short's below it. Getting this
 * backwards reports every disciplined short as an early exit.
 */
export function exitedBeforeTarget(trade: BehaviourInput): boolean | null {
  const { direction, exit_price, take_profit } = trade;
  if (exit_price == null || take_profit == null || !direction) return null;
  return direction === "short" ? exit_price > take_profit : exit_price < take_profit;
}

/** Days between entry and exit. Null unless both dates exist. */
export function holdingDays(trade: BehaviourInput): number | null {
  if (!trade.entry_date || !trade.exit_date) return null;
  const ms = new Date(trade.exit_date).getTime() - new Date(trade.entry_date).getTime();
  return Number.isFinite(ms) ? ms / 86_400_000 : null;
}

interface ClosedForStreak {
  id: string;
  exit_date: string | null;
  dollar_pl: number | null;
}

/**
 * The trades that had already closed when a trade was entered, newest exit
 * first. The one definition behind "the run of results before this trade",
 * shared by the Emotions page's tilt card and the AI review, so the two can
 * never disagree about whether a trade came after a losing streak.
 */
export function closedBefore<T extends ClosedForStreak>(entryDate: string | null, trades: T[], excludeId?: string): T[] {
  const entered = entryDate ? Date.parse(entryDate) : NaN;
  if (!Number.isFinite(entered)) return [];
  return trades
    .filter((t) => t.id !== excludeId && t.exit_date != null && Date.parse(t.exit_date) <= entered)
    .sort((a, b) => Date.parse(b.exit_date!) - Date.parse(a.exit_date!));
}

/** Consecutive losses (net P&L below zero) among closedBefore, newest first; break-even ends a streak. */
export function lossStreakBefore(entryDate: string | null, trades: ClosedForStreak[], excludeId?: string): number {
  let streak = 0;
  for (const t of closedBefore(entryDate, trades, excludeId)) {
    if ((t.dollar_pl ?? 0) < 0) streak += 1;
    else break;
  }
  return streak;
}
