import { describe, it, expect } from "vitest";
import { resultFromPL } from "./result";
import { decideAutoExecution, type AutoExecutableTrade } from "./auto-execute";
import { computeDerivedFields } from "./compute";

describe("resultFromPL", () => {
  it("maps positive/negative/zero P&L to win/loss/break_even", () => {
    expect(resultFromPL(150)).toBe("win");
    expect(resultFromPL(-1)).toBe("loss");
    expect(resultFromPL(0)).toBe("break_even");
  });

  it("falls back to open when P&L isn't computable yet", () => {
    expect(resultFromPL(null)).toBe("open");
    expect(resultFromPL(undefined)).toBe("open");
  });
});

// Regression for the bug this file was added to fix: a take-profit touch is
// the favorable side of `decideAutoExecution`, but if round-trip commission
// exceeds the thin profit margin at the target price, the *net* result is a
// loss -- the stored `result` must follow dollar_pl, not which level fired.
describe("auto-execute + resultFromPL integration", () => {
  it("a target hit with commission larger than the gross profit nets a loss, not a win", () => {
    const trade: AutoExecutableTrade = {
      mode: "trade",
      status: "open",
      direction: "long",
      entry_price: 100,
      stop_loss: 95,
      take_profit: 100.1,
      entry_date: "2026-07-01T00:00:00Z",
    };
    const decision = decideAutoExecution(trade, { dayLow: 99, dayHigh: 101 });
    expect(decision?.trigger).toBe("take_profit");
    expect(decision?.changes).not.toHaveProperty("result");

    const derived = computeDerivedFields({
      entry_price: trade.entry_price,
      exit_price: decision!.changes.exit_price!,
      stop_loss: trade.stop_loss,
      take_profit: trade.take_profit,
      shares: 10,
      risk_amount: 50,
      direction: trade.direction,
      commission: 5, // gross profit is 10 * $0.10 = $1, commission wipes it out
    });

    expect(derived.dollar_pl).toBeLessThan(0);
    expect(resultFromPL(derived.dollar_pl)).toBe("loss");
  });
});
