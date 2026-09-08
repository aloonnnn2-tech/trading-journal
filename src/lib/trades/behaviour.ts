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
