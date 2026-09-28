import { describe, expect, it } from "vitest";
import { OPERATORS } from "@/lib/plan-rules/types";
import { priceMismatch } from "@/lib/market-data/trade-window";
import journal from "./journal.json";
import { buildDemoPayload } from "./payload";

// The demo journal a new account can start with (Phase 4D), built offline by
// scripts/build-demo-journal.mjs from real Yahoo bars. These hold it to what
// the app promises about it: real prices (every fill on its bar, so no chart
// ever shows the "outside the range" note), a believable journal, and rows
// the seed function can insert.

const DEFAULT_TRADE_FIELDS = new Set([
  "notes_why_entered",
  "notes_what_right",
  "notes_what_change",
  "notes_lessons_learned",
  "notes_additional",
  "emotion_before",
  "emotion_during",
  "emotion_after",
  "emotion_intensity",
  "trade_mistakes",
]);

describe("demo journal", () => {
  const trades = journal.trades;

  it("has enough trades to fill every page, with a believable mix", () => {
    expect(trades.length).toBeGreaterThanOrEqual(50);
    const wins = buildDemoPayload().trades.filter((t) => t.row.result === "win").length;
    expect(wins / trades.length).toBeGreaterThan(0.4);
    expect(wins / trades.length).toBeLessThan(0.65);
    expect(new Set(trades.map((t) => t.key)).size).toBe(trades.length);
  });

  it("puts every entry and exit on its real market bar", () => {
    for (const t of trades) {
      const bar = (b: { time: number; low: number; high: number }) => [{ ...b, open: b.low, close: b.high }];
      const onEntry = priceMismatch(bar(t.check.entryBar), {
        entryPrice: t.row.entry_price,
        entry: { index: 0, inside: true },
        exitPrice: null,
        exit: { index: -1, inside: false },
      });
      const onExit = priceMismatch(bar(t.check.exitBar), {
        entryPrice: null,
        entry: { index: -1, inside: false },
        exitPrice: t.row.exit_price,
        exit: { index: 0, inside: true },
      });
      expect({ key: t.key, onEntry, onExit }).toEqual({ key: t.key, onEntry: null, onExit: null });
    }
  });

  it("times every fill inside its bar, and every exit after its entry", () => {
    for (const t of trades) {
      const entry = Date.parse(t.row.entry_date) / 1000;
      const exit = Date.parse(t.row.exit_date) / 1000;
      expect(entry).toBeGreaterThanOrEqual(t.check.entryBar.time);
      expect(exit).toBeGreaterThan(entry);
      expect(exit).toBeGreaterThanOrEqual(t.check.exitBar.time);
    }
  });

  it("is entirely in the past as of when it was built", () => {
    const built = Date.parse(journal.generatedAt);
    for (const t of trades) expect(Date.parse(t.row.exit_date)).toBeLessThan(built);
    expect(Date.parse(journal.account.depositAt)).toBeLessThan(Date.parse(trades[0].row.entry_date));
  });

  it("puts stops and targets on the right side of the entry", () => {
    for (const t of trades) {
      const sign = t.row.direction === "short" ? -1 : 1;
      expect((t.row.entry_price - t.row.stop_loss) * sign).toBeGreaterThan(0);
      expect((t.row.take_profit - t.row.entry_price) * sign).toBeGreaterThan(0);
    }
  });

  it("tags only strategies it defines, with rules the engine understands", () => {
    const keys = new Set(journal.strategies.map((s) => s.key));
    for (const t of trades) expect(keys.has(t.strategy)).toBe(true);
    for (const s of journal.strategies) {
      for (const r of s.rules) expect(OPERATORS).toContain(r.operator);
    }
  });

  it("writes notes and emotions only into the default fields every account has", () => {
    for (const t of trades) {
      for (const key of Object.keys(t.row.custom_fields)) expect(DEFAULT_TRADE_FIELDS.has(key)).toBe(true);
    }
  });

  it("gives the Mistakes and plan-adherence panels something to show", () => {
    const moved = trades.filter((t) => t.row.custom_fields.trade_mistakes.includes("Moved stop"));
    expect(moved.length).toBeGreaterThanOrEqual(2);
    // A moved stop is only visible through edit history: each has the
    // pre-edit snapshot, with a different stop from the final one.
    for (const t of moved) {
      expect(t.history).toHaveLength(1);
      expect(t.history[0].snapshot.stop_loss).not.toBe(t.row.stop_loss);
    }
  });
});
