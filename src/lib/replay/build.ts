import { HISTORY_RETENTION_LIMIT } from "@/lib/trades/adjustments";
import type { Trade } from "@/lib/trades/types";

// Turning a trade's edit snapshots into a readable timeline.
//
// **This is an audit trail of the JOURNAL, not of the market.** Every event
// derived from a snapshot is stamped with when the row was EDITED, which is
// not necessarily when the thing happened: a stop moved on Tuesday and
// recorded on Friday appears on Friday. Events carry `recorded: true` to say
// so, and the UI labels them, because the alternative -- presenting a
// journalling timestamp as a market timestamp -- is a precision this data does
// not have. It is also why these events are not drawn on the price chart.
//
// **No second history system.** Everything here reads the snapshots migration
// 0008's trigger already writes; nothing new is stored.
//
// **Two things in the brief cannot be represented and are omitted rather than
// approximated:**
//   - PARTIAL EXITS. The schema holds one entry_price, one exit_price and one
//     `shares`. There is no scale-out model anywhere in this app, so a partial
//     exit event would be invented.
//   - STRATEGY SELECTION. Strategies live in the `trade_strategies` join
//     table, which has no history trigger. The snapshot is the `trades` row
//     alone, so tagging and untagging leave no record to replay.

export type ReplayEventKind = "created" | "entry" | "exit" | "change";

export interface ReplayEvent {
  kind: ReplayEventKind;
  /** ISO timestamp this event is placed at. */
  at: string;
  /**
   * True when `at` is when the change was WRITTEN DOWN rather than when it
   * happened in the market. Every `change` event is recorded; entry and exit
   * come from the trader's own dates and are not.
   */
  recorded: boolean;
  label: string;
  /** Previous and new values, already formatted. Only on `change`. */
  from?: string;
  to?: string;
}

export interface Replay {
  events: ReplayEvent[];
  /** True when history sits at the retention cap, so earlier changes may have
   *  been pruned and the timeline is not necessarily complete. */
  mayBeTruncated: boolean;
  /** Snapshots available. Zero means the trade was never edited after being
   *  created -- which is a real answer, not missing data. */
  snapshots: number;
}

/** A history row as the builder needs it, oldest first. */
export interface ReplaySnapshot {
  createdAt: string;
  snapshot: Partial<Trade> | null;
}

function money(value: unknown): string {
  if (value == null || value === "") return "not set";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;
}

function plain(value: unknown): string {
  if (value == null || value === "") return "not set";
  return String(value).replace(/_/g, " ");
}

function quantity(value: unknown): string {
  if (value == null || value === "") return "not set";
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : String(value);
}

/**
 * The fields worth replaying, and how each reads.
 *
 * A curated list rather than every column: an edit to `updated_at` or
 * `custom_fields` is not a decision anyone replays, and showing it would bury
 * the four events that matter in noise.
 */
const TRACKED: { key: keyof Trade; label: string; format: (v: unknown) => string }[] = [
  { key: "status", label: "Status", format: plain },
  { key: "entry_price", label: "Entry price", format: money },
  { key: "stop_loss", label: "Stop loss", format: money },
  { key: "take_profit", label: "Target", format: money },
  { key: "exit_price", label: "Exit price", format: money },
  { key: "shares", label: "Quantity", format: quantity },
  { key: "result", label: "Result", format: plain },
];

/** Whether a snapshot actually carries this key, as opposed to holding null
 *  for it. See the note in the change loop for why the difference matters. */
function hasField(snapshot: Partial<Trade> | null, key: keyof Trade): boolean {
  return snapshot != null && Object.prototype.hasOwnProperty.call(snapshot, key);
}

/**
 * Builds the timeline.
 *
 * **The snapshot-to-change mapping is the subtle part.** Migration 0008's
 * trigger runs BEFORE each update and stores the OLD row, so a snapshot means
 * "at this time, the value changed away from this". The value it changed TO is
 * therefore the NEXT snapshot's value -- or the trade's current value, for the
 * last one. Reading a snapshot as "the value at that time" would report every
 * change one step late and attribute the final state to the wrong moment.
 *
 * @param snapshots Oldest first.
 */
export function buildReplay(trade: Trade, snapshots: ReplaySnapshot[]): Replay {
  const events: ReplayEvent[] = [];

  if (trade.created_at) {
    events.push({ kind: "created", at: trade.created_at, recorded: true, label: "Trade logged" });
  }
  if (trade.entry_date) {
    // The trader's own entry time: a market event, not a journalling one.
    events.push({ kind: "entry", at: trade.entry_date, recorded: false, label: "Entered" });
  }

  for (const field of TRACKED) {
    for (let i = 0; i < snapshots.length; i++) {
      const beforeSnap = snapshots[i].snapshot;
      const afterSnap = i + 1 < snapshots.length ? snapshots[i + 1].snapshot : null;

      // A field ABSENT from a snapshot is unknown, not null. Old snapshots
      // predate columns added since -- the same hazard restoreTradeVersion
      // guards against for commission -- and treating a missing key as an
      // empty value would manufacture a "not set -> $5" change that never
      // happened. Unknown on either side means the change cannot be read, so
      // it is skipped rather than guessed.
      if (!hasField(beforeSnap, field.key)) continue;
      if (afterSnap !== null && !hasField(afterSnap, field.key)) continue;

      const before = beforeSnap?.[field.key] ?? null;
      const after = afterSnap !== null ? (afterSnap[field.key] ?? null) : (trade[field.key] ?? null);

      // Consecutive duplicates are the normal case, not the exception: the
      // trigger snapshots the WHOLE row on every autosave, so typing a note
      // writes a row in which nothing tracked here changed.
      if (before === after) continue;

      events.push({
        kind: "change",
        at: snapshots[i].createdAt,
        recorded: true,
        label: field.label,
        from: field.format(before),
        to: field.format(after),
      });
    }
  }

  if (trade.exit_date) {
    events.push({ kind: "exit", at: trade.exit_date, recorded: false, label: "Exited" });
  }

  return {
    // Stable order: by time, and within the same instant by the order the
    // fields are listed above, so a single save that changed three fields
    // reads consistently rather than shuffling between renders.
    events: events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()),
    mayBeTruncated: snapshots.length >= HISTORY_RETENTION_LIMIT,
    snapshots: snapshots.length,
  };
}
