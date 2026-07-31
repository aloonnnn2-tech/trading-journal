import { describe, it, expect } from "vitest";
import { decideAutoExecution, isWatchable, describeAutoExecution, type AutoExecutableTrade } from "./auto-execute";

const NOW = new Date("2026-07-31T12:00:00Z");

function trade(over: Partial<AutoExecutableTrade> = {}): AutoExecutableTrade {
  return {
    mode: "trade",
    status: "open",
    direction: "long",
    entry_price: 100,
    stop_loss: 95,
    take_profit: 110,
    entry_date: "2026-07-01T00:00:00Z",
    ...over,
  } as AutoExecutableTrade;
}

describe("pending -> open", () => {
  const pending = trade({ status: "pending", entry_date: null });

  it("fills when the session's range brackets the entry price", () => {
    const d = decideAutoExecution(pending, { dayLow: 99, dayHigh: 101 }, NOW);
    expect(d?.trigger).toBe("entry");
    expect(d?.changes.status).toBe("open");
    expect(d?.changes.entry_date).toBe(NOW.toISOString());
  });

  it("fills on an exact touch of either edge", () => {
    expect(decideAutoExecution(pending, { dayLow: 100, dayHigh: 105 }, NOW)).not.toBeNull();
    expect(decideAutoExecution(pending, { dayLow: 95, dayHigh: 100 }, NOW)).not.toBeNull();
  });

  it("does nothing when price never reached the entry", () => {
    expect(decideAutoExecution(pending, { dayLow: 101, dayHigh: 105 }, NOW)).toBeNull();
    expect(decideAutoExecution(pending, { dayLow: 90, dayHigh: 99 }, NOW)).toBeNull();
  });

  it("preserves an entry date that was already set", () => {
    const d = decideAutoExecution(trade({ status: "pending" }), { dayLow: 99, dayHigh: 101 }, NOW);
    expect(d?.changes.entry_date).toBeUndefined();
  });

  it("does nothing without an entry price to trigger on", () => {
    expect(decideAutoExecution(trade({ status: "pending", entry_price: null }), { dayLow: 0, dayHigh: 999 }, NOW)).toBeNull();
  });
});

describe("open -> closed, long", () => {
  it("closes as a loss when the low reaches the stop", () => {
    const d = decideAutoExecution(trade(), { dayLow: 94, dayHigh: 101 }, NOW);
    expect(d?.trigger).toBe("stop_loss");
    expect(d?.changes).toMatchObject({ status: "closed", exit_price: 95, result: "loss" });
  });

  it("closes as a win when the high reaches the target", () => {
    const d = decideAutoExecution(trade(), { dayLow: 99, dayHigh: 111 }, NOW);
    expect(d?.trigger).toBe("take_profit");
    expect(d?.changes).toMatchObject({ status: "closed", exit_price: 110, result: "win" });
  });

  it("stays open between the levels", () => {
    expect(decideAutoExecution(trade(), { dayLow: 96, dayHigh: 109 }, NOW)).toBeNull();
  });
});

describe("open -> closed, short", () => {
  const short = trade({ direction: "short", stop_loss: 105, take_profit: 90 });

  it("stops out when the high reaches the stop above entry", () => {
    const d = decideAutoExecution(short, { dayLow: 99, dayHigh: 106 }, NOW);
    expect(d?.changes).toMatchObject({ exit_price: 105, result: "loss" });
  });

  it("takes profit when the low reaches the target below entry", () => {
    const d = decideAutoExecution(short, { dayLow: 89, dayHigh: 101 }, NOW);
    expect(d?.changes).toMatchObject({ exit_price: 90, result: "win" });
  });
});

// A volatile session can bracket both levels with no way to tell from daily
// data which came first. Recording a win would be optimistic; the stop wins.
describe("ambiguous sessions", () => {
  it("resolves a both-levels-touched day as the stop", () => {
    const d = decideAutoExecution(trade(), { dayLow: 94, dayHigh: 111 }, NOW);
    expect(d?.trigger).toBe("stop_loss");
    expect(d?.changes.result).toBe("loss");
  });

  it("does the same for a short", () => {
    const short = trade({ direction: "short", stop_loss: 105, take_profit: 90 });
    const d = decideAutoExecution(short, { dayLow: 89, dayHigh: 106 }, NOW);
    expect(d?.changes.result).toBe("loss");
  });
});

describe("refuses to guess", () => {
  it("does nothing without a direction — can't tell a stop-out from a target", () => {
    expect(decideAutoExecution(trade({ direction: null }), { dayLow: 90, dayHigh: 120 }, NOW)).toBeNull();
  });

  it("ignores investment positions", () => {
    expect(decideAutoExecution(trade({ mode: "investment" }), { dayLow: 90, dayHigh: 120 }, NOW)).toBeNull();
  });

  it("ignores an already-closed trade", () => {
    expect(decideAutoExecution(trade({ status: "closed" }), { dayLow: 90, dayHigh: 120 }, NOW)).toBeNull();
  });

  it("ignores a missing or malformed price snapshot", () => {
    expect(decideAutoExecution(trade(), { dayLow: null, dayHigh: 110 }, NOW)).toBeNull();
    expect(decideAutoExecution(trade(), { dayLow: 100, dayHigh: null }, NOW)).toBeNull();
    expect(decideAutoExecution(trade(), { dayLow: 120, dayHigh: 90 }, NOW)).toBeNull();
  });

  it("only watches the level that exists", () => {
    const noStop = trade({ stop_loss: null });
    expect(decideAutoExecution(noStop, { dayLow: 80, dayHigh: 100 }, NOW)).toBeNull();
    expect(decideAutoExecution(noStop, { dayLow: 99, dayHigh: 111 })?.trigger).toBe("take_profit");
  });
});

describe("isWatchable", () => {
  it("includes a pending order with an entry price", () => {
    expect(isWatchable(trade({ status: "pending" }))).toBe(true);
    expect(isWatchable(trade({ status: "pending", entry_price: null }))).toBe(false);
  });

  it("includes an open trade with a direction and at least one level", () => {
    expect(isWatchable(trade())).toBe(true);
    expect(isWatchable(trade({ stop_loss: null, take_profit: 110 }))).toBe(true);
    expect(isWatchable(trade({ stop_loss: null, take_profit: null }))).toBe(false);
    expect(isWatchable(trade({ direction: null }))).toBe(false);
  });

  it("excludes closed trades and investments", () => {
    expect(isWatchable(trade({ status: "closed" }))).toBe(false);
    expect(isWatchable(trade({ mode: "investment" }))).toBe(false);
  });
});

describe("describeAutoExecution", () => {
  it("reads as a sentence for each trigger", () => {
    expect(describeAutoExecution(decideAutoExecution(trade({ status: "pending" }), { dayLow: 99, dayHigh: 101 }, NOW)!)).toBe(
      "Entry hit at $100 — marked as open.",
    );
    expect(describeAutoExecution(decideAutoExecution(trade(), { dayLow: 94, dayHigh: 101 }, NOW)!)).toBe(
      "Stop loss hit at $95 — trade closed.",
    );
    expect(describeAutoExecution(decideAutoExecution(trade(), { dayLow: 99, dayHigh: 111 }, NOW)!)).toBe(
      "Take profit hit at $110 — trade closed.",
    );
  });
});
