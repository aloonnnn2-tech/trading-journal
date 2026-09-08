import type { Trade } from "./types";

// Detecting that a stop or target was MOVED during a trade.
//
// This is the only place the app can see it. The `trades` row holds the
// *current* stop, so a stop that was walked down twice looks identical to one
// that was planned there from the start -- the difference lives entirely in
// the pre-edit snapshots that migration 0008's trigger writes to
// `trade_history`.
//
// Extracted here because two features need the same answer: the AI trade
// review describes the movement in its prompt, and a plan rule can test
// "stop was not moved". Two implementations of the same detection would be
// two definitions of what counts as a moved stop, and the one that drifted
// would put a rule violation next to an AI review saying nothing happened.
//
// **KNOWN LIMIT, and it must be stated wherever this is surfaced:**
// migration 0023 caps `trade_history` at the newest 50 snapshots per trade,
// and the trade card's autosave writes one every ~600ms while editing. A
// heavily-edited trade can therefore have had older snapshots pruned, so this
// can MISS a change that really happened. It can never invent one. Callers
// must present a negative as "no change in the retained history", never as
// proof that nothing was moved.

/** The two fields worth tracking movement on, and their display names. */
const TRACKED = [
  ["stop_loss", "Stop loss"],
  ["take_profit", "Take profit"],
] as const;

type TrackedKey = (typeof TRACKED)[number][0];

export interface FieldAdjustment {
  key: TrackedKey;
  label: string;
  /** Distinct values in order, oldest first, ending at the current value. */
  timeline: (number | null)[];
  /** Transitions between distinct values -- one fewer than the timeline. */
  changes: number;
}

/**
 * What migration 0023 caps `trade_history` at, per trade.
 *
 * Mirrored here so callers can tell a trade that was never edited (zero
 * snapshots -- "nothing moved" is trustworthy) from one sitting at the cap,
 * where an early change may have been pruned and a negative result is only
 * "nothing moved in what we still have".
 */
export const HISTORY_RETENTION_LIMIT = 50;

export interface TradeAdjustments {
  stopMoved: boolean;
  targetMoved: boolean;
  /** Only the fields that actually changed. */
  adjustments: FieldAdjustment[];
  /** False when no snapshots survive, so callers can say "no history" rather
   *  than "nothing changed" -- those are different claims. */
  hasHistory: boolean;
  /**
   * True when history is at the retention cap, so older snapshots may have
   * been dropped and a "not moved" answer is not proof. Surface this wherever
   * a negative result is shown.
   */
  mayBeTruncated: boolean;
}

/** The shape this needs from a history row. Loose on purpose: an old snapshot
 *  predates whatever columns were added since, so any field may be absent. */
export interface AdjustmentSnapshot {
  stop_loss?: number | null;
  take_profit?: number | null;
}

/**
 * @param snapshots  Pre-edit snapshots, **oldest first**.
 * @param current    The trade as it stands now.
 */
export function detectAdjustments(
  snapshots: AdjustmentSnapshot[],
  current: Pick<Trade, "stop_loss" | "take_profit">,
): TradeAdjustments {
  const adjustments: FieldAdjustment[] = [];

  for (const [key, label] of TRACKED) {
    const timeline: (number | null)[] = [];

    for (const value of [...snapshots.map((s) => s[key] ?? null), current[key] ?? null]) {
      // Collapse consecutive duplicates. Every edit snapshots the WHOLE row,
      // so without this each note the trader typed would register as a stop
      // move -- the single most misleading thing this function could report.
      if (timeline.length === 0 || timeline[timeline.length - 1] !== value) timeline.push(value);
    }

    if (timeline.length > 1) {
      adjustments.push({ key, label, timeline, changes: timeline.length - 1 });
    }
  }

  return {
    stopMoved: adjustments.some((a) => a.key === "stop_loss"),
    targetMoved: adjustments.some((a) => a.key === "take_profit"),
    adjustments,
    hasHistory: snapshots.length > 0,
    mayBeTruncated: snapshots.length >= HISTORY_RETENTION_LIMIT,
  };
}
