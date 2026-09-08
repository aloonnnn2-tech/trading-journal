import { describe, expect, it } from "vitest";
import { HISTORY_RETENTION_LIMIT } from "@/lib/trades/adjustments";
import type { Trade } from "@/lib/trades/types";
import { buildReplay, type ReplaySnapshot } from "./build";

// The snapshot-to-change mapping is what these tests exist for. Migration
// 0008's trigger stores the OLD row before each update, so a snapshot means
// "the value changed away from this, here". Reading it as "the value was this,
// then" reports every change one step late -- which looks plausible and is
// wrong, and is exactly the kind of error a timeline would hide.

function trade(over: Partial<Trade> = {}): Trade {
  return {
    id: "t1",
    created_at: "2026-08-10T09:00:00Z",
    entry_date: "2026-08-10T13:30:00Z",
    exit_date: "2026-08-14T19:00:00Z",
    status: "closed",
    result: "win",
    entry_price: 100,
    exit_price: 110,
    stop_loss: 95,
    take_profit: 120,
    shares: 10,
    ...over,
  } as Trade;
}

/**
 * A snapshot as the trigger really writes one: `to_jsonb(old)`, the WHOLE row.
 * The overrides are the fields that differed at that moment; everything else
 * matches the trade's current state, which is what makes an unchanged field
 * genuinely unchanged rather than spuriously "not set".
 */
function snap(createdAt: string, overrides: Partial<Trade>): ReplaySnapshot {
  return { createdAt, snapshot: { ...trade(), ...overrides } };
}

describe("buildReplay — the base events", () => {
  it("places logging, entry and exit", () => {
    const replay = buildReplay(trade(), []);
    expect(replay.events.map((e) => e.kind)).toEqual(["created", "entry", "exit"]);
  });

  it("marks entry and exit as market times, not recording times", () => {
    // These come from the trader's own dates, so they are not journalling
    // timestamps and must not be labelled as such.
    const replay = buildReplay(trade(), []);
    const entry = replay.events.find((e) => e.kind === "entry")!;
    const exit = replay.events.find((e) => e.kind === "exit")!;

    expect(entry.recorded).toBe(false);
    expect(exit.recorded).toBe(false);
  });

  it("omits entry and exit when the trade has no such dates", () => {
    const replay = buildReplay(trade({ entry_date: null, exit_date: null }), []);
    expect(replay.events.map((e) => e.kind)).toEqual(["created"]);
  });

  it("reports zero snapshots as a real answer, not missing data", () => {
    // A trade never edited after creation genuinely has no history.
    const replay = buildReplay(trade(), []);
    expect(replay.snapshots).toBe(0);
    expect(replay.mayBeTruncated).toBe(false);
  });
});

describe("buildReplay — change mapping", () => {
  it("reads a snapshot as the value changed AWAY from, at that time", () => {
    // Snapshot at T1 holds stop 95; the trade's current stop is 90. So at T1
    // the stop moved 95 -> 90. Reading the snapshot as "the stop was 95 at T1"
    // would lose the change entirely.
    const replay = buildReplay(
      trade({ stop_loss: 90 }),
      [snap("2026-08-11T10:00:00Z", { stop_loss: 95 })],
    );

    const change = replay.events.find((e) => e.kind === "change")!;
    expect(change.label).toBe("Stop loss");
    expect(change.from).toBe("$95.00");
    expect(change.to).toBe("$90.00");
    expect(change.at).toBe("2026-08-11T10:00:00Z");
  });

  it("chains consecutive snapshots so each change points at the next value", () => {
    // 95 -> 92 at T1, then 92 -> 90 at T2 (90 being the current value).
    const replay = buildReplay(trade({ stop_loss: 90 }), [
      snap("2026-08-11T10:00:00Z", { stop_loss: 95 }),
      snap("2026-08-12T10:00:00Z", { stop_loss: 92 }),
    ]);

    const changes = replay.events.filter((e) => e.kind === "change");
    expect(changes.map((c) => [c.from, c.to])).toEqual([
      ["$95.00", "$92.00"],
      ["$92.00", "$90.00"],
    ]);
  });

  it("ignores snapshots where the tracked field did not change", () => {
    // The trigger snapshots the WHOLE row on every autosave, so typing a note
    // writes rows in which nothing tracked here moved. Those are not events.
    const replay = buildReplay(trade({ stop_loss: 95 }), [
      snap("2026-08-11T10:00:00Z", { stop_loss: 95 }),
      snap("2026-08-11T10:00:01Z", { stop_loss: 95 }),
      snap("2026-08-11T10:00:02Z", { stop_loss: 95 }),
    ]);

    expect(replay.events.filter((e) => e.kind === "change")).toHaveLength(0);
    // The snapshots still existed, which is different from there being none.
    expect(replay.snapshots).toBe(3);
  });

  it("marks a value being set for the first time", () => {
    const replay = buildReplay(trade({ take_profit: 120 }), [
      snap("2026-08-11T10:00:00Z", { take_profit: null }),
    ]);
    const change = replay.events.find((e) => e.label === "Target")!;
    expect(change.from).toBe("not set");
    expect(change.to).toBe("$120.00");
  });

  it("records a status transition", () => {
    const replay = buildReplay(trade({ status: "closed" }), [
      snap("2026-08-10T13:30:00Z", { status: "pending" }),
      snap("2026-08-14T19:00:00Z", { status: "open" }),
    ]);
    const statuses = replay.events.filter((e) => e.label === "Status");

    expect(statuses.map((s) => [s.from, s.to])).toEqual([
      ["pending", "open"],
      ["open", "closed"],
    ]);
  });

  it("marks every change as recorded rather than observed", () => {
    // The heart of the feature's honesty: these timestamps are edits.
    const replay = buildReplay(trade({ stop_loss: 90 }), [
      snap("2026-08-11T10:00:00Z", { stop_loss: 95 }),
    ]);
    expect(replay.events.filter((e) => e.kind === "change").every((e) => e.recorded)).toBe(true);
  });
});

describe("buildReplay — ordering and completeness", () => {
  it("orders every event by time", () => {
    const replay = buildReplay(trade({ stop_loss: 90, take_profit: 130 }), [
      snap("2026-08-13T10:00:00Z", { stop_loss: 95, take_profit: 120 }),
    ]);

    const times = replay.events.map((e) => new Date(e.at).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("flags a timeline that may be missing its earliest events", () => {
    // Migration 0023 caps history at 50 per trade, so a heavily-edited trade
    // has lost its oldest snapshots and the timeline is not complete.
    const many = Array.from({ length: HISTORY_RETENTION_LIMIT }, (_, i) =>
      snap(`2026-08-11T10:00:${String(i).padStart(2, "0")}Z`, { stop_loss: 95 }),
    );
    expect(buildReplay(trade(), many).mayBeTruncated).toBe(true);
  });

  it("does not flag truncation below the cap", () => {
    const few = [snap("2026-08-11T10:00:00Z", { stop_loss: 95 })];
    expect(buildReplay(trade(), few).mayBeTruncated).toBe(false);
  });

  it("survives a null snapshot body without throwing", () => {
    const replay = buildReplay(trade(), [{ createdAt: "2026-08-11T10:00:00Z", snapshot: null }]);
    expect(replay.events.length).toBeGreaterThan(0);
  });
});
