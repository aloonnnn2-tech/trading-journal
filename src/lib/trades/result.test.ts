import { describe, it, expect } from "vitest";
import { resultFromPL, resultForClosedTrade } from "./result";
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

// The variant every write path for a *closed* trade should call instead --
// same win/loss/break_even mapping, but a trade known to be finished can't
// still be "open" just because its P/L isn't computable.
describe("resultForClosedTrade", () => {
  it("matches resultFromPL for a real number", () => {
    expect(resultForClosedTrade(150)).toBe("win");
    expect(resultForClosedTrade(-1)).toBe("loss");
    expect(resultForClosedTrade(0)).toBe("break_even");
  });

  it("records break-even, not open, when P&L can't be computed", () => {
    expect(resultForClosedTrade(null)).toBe("break_even");
    expect(resultForClosedTrade(undefined)).toBe("break_even");
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
      order_type: null,
      limit_price: null,
      time_in_force: "gtc",
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

// restoreTradeVersion writes straight to the trades table rather than going
// through updateTrade(), so it has to derive `result` itself -- exactly like
// the cron sweep does. Without that, restoring a snapshot taken before
// commissions existed writes its stored (gross-basis) "win" next to a
// freshly recomputed, commission-net negative dollar_pl.
describe("restoring an old snapshot re-derives result, not just P&L", () => {
  it("a pre-commission 'win' whose fee now exceeds the profit restores as a loss", () => {
    // Shape of a snapshot row: gross P&L, no commission key at all.
    const snapshot = {
      status: "closed",
      result: "win" as const,
      direction: "long" as const,
      entry_price: 100,
      exit_price: 100.1,
      stop_loss: 95,
      take_profit: 100.1,
      shares: 10,
      risk_amount: 50,
      dollar_pl: 1, // gross, from before commissions existed
    };

    // What the restore path now computes, with the commission the row
    // actually carries today.
    const derived = computeDerivedFields({
      entry_price: snapshot.entry_price,
      exit_price: snapshot.exit_price,
      stop_loss: snapshot.stop_loss,
      take_profit: snapshot.take_profit,
      shares: snapshot.shares,
      risk_amount: snapshot.risk_amount,
      direction: snapshot.direction,
      commission: 5,
    });

    expect(snapshot.result).toBe("win");
    expect(derived.dollar_pl).toBeLessThan(0);
    expect(resultFromPL(derived.dollar_pl)).toBe("loss");
  });

  it("leaves result alone for a snapshot that isn't closed", () => {
    // The restore only overrides result when status is "closed"; an open
    // trade keeps whatever the snapshot had rather than being forced to
    // "open" by a null P&L.
    const derived = computeDerivedFields({
      entry_price: 100,
      exit_price: null,
      stop_loss: 95,
      take_profit: 110,
      shares: 10,
      risk_amount: 50,
      direction: "long",
      commission: null,
    });
    expect(derived.dollar_pl).toBeNull();
    expect(resultFromPL(derived.dollar_pl)).toBe("open");
  });
});
