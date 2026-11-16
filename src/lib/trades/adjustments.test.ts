import { describe, expect, it } from "vitest";
import { detectAdjustments } from "./adjustments";

describe("detectAdjustments", () => {
  it("does not call the first time a stop is set a move", () => {
    // What Quick trade leaves behind: one snapshot of the blank row, then the
    // trade with its stop.
    const result = detectAdjustments([{ stop_loss: null, take_profit: null }], {
      stop_loss: 185,
      take_profit: 198,
    });

    expect(result.stopMoved).toBe(false);
    expect(result.targetMoved).toBe(false);
    expect(result.adjustments).toEqual([]);
    expect(result.hasHistory).toBe(true);
  });

  it("ignores any number of blank snapshots before the first value", () => {
    const result = detectAdjustments(
      [{ stop_loss: null }, { stop_loss: null }, {}],
      { stop_loss: 185, take_profit: null },
    );

    expect(result.stopMoved).toBe(false);
  });

  it("still reports a stop changed after it was set", () => {
    const result = detectAdjustments(
      [{ stop_loss: null }, { stop_loss: 185 }],
      { stop_loss: 180, take_profit: null },
    );

    expect(result.stopMoved).toBe(true);
    expect(result.adjustments).toEqual([
      { key: "stop_loss", label: "Stop loss", timeline: [185, 180], changes: 1 },
    ]);
  });

  it("still reports a stop that was set and then removed", () => {
    const result = detectAdjustments([{ stop_loss: 185 }], { stop_loss: null, take_profit: null });

    expect(result.stopMoved).toBe(true);
    expect(result.adjustments[0].timeline).toEqual([185, null]);
  });

  it("tracks stop and target separately", () => {
    const result = detectAdjustments(
      [{ stop_loss: null, take_profit: null }, { stop_loss: 185, take_profit: 198 }],
      { stop_loss: 185, take_profit: 205 },
    );

    expect(result.stopMoved).toBe(false);
    expect(result.targetMoved).toBe(true);
  });

  it("does not count edits that left the levels alone", () => {
    const result = detectAdjustments(
      [{ stop_loss: 185 }, { stop_loss: 185 }, { stop_loss: 185 }],
      { stop_loss: 185, take_profit: null },
    );

    expect(result.stopMoved).toBe(false);
  });
});
