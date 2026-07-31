import { describe, it, expect } from "vitest";
import { computeDerivedFields } from "./compute";
import type { TradeCoreFields } from "./types";

function core(over: Partial<TradeCoreFields> = {}): TradeCoreFields {
  return {
    entry_price: null,
    exit_price: null,
    stop_loss: null,
    take_profit: null,
    shares: null,
    risk_amount: null,
    direction: null,
    commission: null,
    ...over,
  };
}

describe("dollar_pl", () => {
  it("is price movement times size for a long", () => {
    expect(computeDerivedFields(core({ entry_price: 100, exit_price: 110, shares: 10 })).dollar_pl).toBe(100);
  });

  it("inverts for a short", () => {
    const r = computeDerivedFields(core({ entry_price: 100, exit_price: 90, shares: 10, direction: "short" }));
    expect(r.dollar_pl).toBe(100);
  });

  it("treats a missing direction as long", () => {
    expect(computeDerivedFields(core({ entry_price: 100, exit_price: 110, shares: 1 })).dollar_pl).toBe(10);
  });

  // The decision that lets every aggregate in the app stay correct without
  // knowing commissions exist: the stored number is what hit the account.
  it("is stored NET of commission", () => {
    const r = computeDerivedFields(core({ entry_price: 90, exit_price: 100, shares: 1, commission: 5 }));
    expect(r.dollar_pl).toBe(5);
  });

  it("can be turned negative by fees alone", () => {
    const r = computeDerivedFields(core({ entry_price: 100, exit_price: 100.5, shares: 1, commission: 5 }));
    expect(r.dollar_pl).toBe(-4.5);
  });

  it("is null until the trade has an exit and a size", () => {
    expect(computeDerivedFields(core({ entry_price: 100, shares: 10 })).dollar_pl).toBeNull();
    expect(computeDerivedFields(core({ entry_price: 100, exit_price: 110 })).dollar_pl).toBeNull();
  });

  it("ignores a non-numeric commission rather than producing NaN", () => {
    const r = computeDerivedFields(
      core({ entry_price: 90, exit_price: 100, shares: 1, commission: Number.NaN }),
    );
    expect(r.dollar_pl).toBe(10);
  });
});

describe("percent_return", () => {
  it("measures net P&L against the gross cost basis", () => {
    const r = computeDerivedFields(core({ entry_price: 100, exit_price: 110, shares: 10 }));
    expect(r.percent_return).toBeCloseTo(10, 9);
  });

  it("is null when the cost basis is zero", () => {
    expect(computeDerivedFields(core({ entry_price: 0, exit_price: 10, shares: 5 })).percent_return).toBeNull();
  });
});

describe("r_multiple", () => {
  it("divides net P&L by the amount risked", () => {
    const r = computeDerivedFields(core({ entry_price: 100, exit_price: 110, shares: 10, risk_amount: 50 }));
    expect(r.r_multiple).toBe(2);
  });

  it("is null without a risk amount, and never divides by zero", () => {
    expect(computeDerivedFields(core({ entry_price: 100, exit_price: 110, shares: 10 })).r_multiple).toBeNull();
    expect(
      computeDerivedFields(core({ entry_price: 100, exit_price: 110, shares: 10, risk_amount: 0 })).r_multiple,
    ).toBeNull();
  });
});

describe("risk_reward_ratio", () => {
  // Deliberately gross: it compares the price levels the user chose, so the
  // same setup scores identically at 1 share or 1000.
  it("compares planned reward against planned risk", () => {
    const r = computeDerivedFields(core({ entry_price: 100, stop_loss: 95, take_profit: 115 }));
    expect(r.risk_reward_ratio).toBe(3);
  });

  it("is unaffected by commission", () => {
    const withFees = computeDerivedFields(
      core({ entry_price: 100, stop_loss: 95, take_profit: 115, commission: 50 }),
    );
    expect(withFees.risk_reward_ratio).toBe(3);
  });

  it("works for a short, where the stop sits above entry", () => {
    const r = computeDerivedFields(
      core({ entry_price: 100, stop_loss: 105, take_profit: 85, direction: "short" }),
    );
    expect(r.risk_reward_ratio).toBe(3);
  });

  it("is null when risk is zero or a level is missing", () => {
    expect(computeDerivedFields(core({ entry_price: 100, stop_loss: 100, take_profit: 110 })).risk_reward_ratio).toBeNull();
    expect(computeDerivedFields(core({ entry_price: 100, take_profit: 110 })).risk_reward_ratio).toBeNull();
  });
});

it("never returns NaN or Infinity from an empty trade", () => {
  const r = computeDerivedFields(core());
  for (const value of Object.values(r)) {
    expect(value === null || Number.isFinite(value)).toBe(true);
  }
});
