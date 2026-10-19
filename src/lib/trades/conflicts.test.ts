import { describe, expect, it } from "vitest";
import { conflictFieldLabel, findConflicts, sameValue, type StoredTradeValues } from "./conflicts";

const stored = (core: Record<string, unknown>, customFields: Record<string, unknown> = {}): StoredTradeValues => ({
  core,
  customFields,
  strategyFieldValues: {},
});

describe("sameValue", () => {
  it("treats the shapes a stored value comes back in as equal", () => {
    expect(sameValue(null, undefined)).toBe(true);
    expect(sameValue(12.5, "12.50")).toBe(true);
    expect(sameValue(["Calm"], ["Calm"])).toBe(true);
    expect(sameValue("AAPL", "AAPL")).toBe(true);
  });

  it("tells real differences apart", () => {
    expect(sameValue(12.5, 13)).toBe(false);
    expect(sameValue("", null)).toBe(false);
    expect(sameValue("12", "12.0")).toBe(false); // two strings: compared as text
    expect(sameValue(["Calm"], ["FOMO"])).toBe(false);
  });
});

describe("findConflicts", () => {
  it("flags a field another tab changed since this one last saw it", () => {
    // This tab saw stop 95 and sets 94; another tab already saved 96.
    const conflicts = findConflicts(stored({ stop_loss: 96 }), { core: { stop_loss: 94 } }, { core: { stop_loss: 95 } });
    expect(conflicts).toEqual([{ scope: "core", key: "stop_loss" }]);
  });

  it("lets a change to a different field through -- the background fill closing the trade doesn't block a note", () => {
    const conflicts = findConflicts(
      stored({ status: "closed", exit_price: 110 }, { notes: "old" }),
      { customFields: { notes: "new" } },
      { customFields: { notes: "old" } },
    );
    expect(conflicts).toEqual([]);
  });

  it("is no conflict when both sides made the same change", () => {
    expect(findConflicts(stored({ ticker: "MSFT" }), { core: { ticker: "MSFT" } }, { core: { ticker: "AAPL" } })).toEqual([]);
  });

  it("checks nothing without a base, so the order-fill hooks and older clients keep saving", () => {
    expect(findConflicts(stored({ stop_loss: 96 }), { core: { stop_loss: 94 } }, {})).toEqual([]);
  });

  it("covers custom fields and strategy fields", () => {
    const s: StoredTradeValues = {
      core: {},
      customFields: { emotion_before: ["FOMO"] },
      strategyFieldValues: { s1: { setup: "B" } },
    };
    const conflicts = findConflicts(
      s,
      { customFields: { emotion_before: ["Calm"] }, strategyFieldValues: { s1: { setup: "C" } } },
      { customFields: { emotion_before: [] }, strategyFieldValues: { s1: { setup: "A" } } },
    );
    expect(conflicts).toEqual([
      { scope: "custom", key: "emotion_before" },
      { scope: "strategy", strategyId: "s1", key: "setup" },
    ]);
  });
});

describe("conflictFieldLabel", () => {
  it("names fields the way a person would", () => {
    expect(conflictFieldLabel({ scope: "core", key: "stop_loss" })).toBe("Stop loss");
    expect(conflictFieldLabel({ scope: "custom", key: "emotion_before" })).toBe("Emotion before");
  });
});
