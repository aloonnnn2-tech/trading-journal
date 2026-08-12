import { describe, expect, it } from "vitest";
import { pendingReason, type PendingInputs } from "./pending-reason";

const t = (overrides: Partial<PendingInputs> = {}): PendingInputs => ({
  entry_price: null,
  exit_price: null,
  shares: null,
  stop_loss: null,
  take_profit: null,
  risk_amount: null,
  status: "open",
  ...overrides,
});

describe("dollar P/L", () => {
  it("says nothing once it can be computed", () => {
    const done = t({ entry_price: 100, exit_price: 110, shares: 10, status: "closed" });
    expect(pendingReason("dollar_pl", done)).toBeUndefined();
  });

  it("doesn't tell you to add an exit price to a trade you haven't closed", () => {
    expect(pendingReason("dollar_pl", t({ entry_price: 100, shares: 10 }))).toBe("Once the trade closes");
  });

  it("does ask for the exit price once the trade is marked closed", () => {
    expect(pendingReason("dollar_pl", t({ entry_price: 100, shares: 10, status: "closed" }))).toBe(
      "Add an exit price",
    );
  });

  it("lists everything missing in one sentence", () => {
    expect(pendingReason("dollar_pl", t({ status: "closed" }))).toBe(
      "Add an entry price, an exit price and a share count",
    );
  });
});

describe("R multiple", () => {
  it("asks for the risk once the P/L side is satisfied", () => {
    const closed = t({ entry_price: 100, exit_price: 110, shares: 10, status: "closed" });
    expect(pendingReason("r_multiple", closed)).toBe("Add a stop loss, or a risk amount");
  });

  it("is satisfied by a risk amount", () => {
    const closed = t({ entry_price: 100, exit_price: 110, shares: 10, risk_amount: 50, status: "closed" });
    expect(pendingReason("r_multiple", closed)).toBeUndefined();
  });

  it("reports the P/L inputs first, since risk alone wouldn't help", () => {
    expect(pendingReason("r_multiple", t({ risk_amount: 50, status: "closed" }))).toContain("Add an entry price");
  });
});

describe("risk/reward", () => {
  it("needs the two price levels, and says which is absent", () => {
    expect(pendingReason("risk_reward_ratio", t({ entry_price: 100, stop_loss: 95 }))).toBe(
      "Add a take profit",
    );
    expect(pendingReason("risk_reward_ratio", t({ entry_price: 100, take_profit: 115 }))).toBe(
      "Add a stop loss",
    );
  });

  it("is available on an open trade -- it's a plan, not a result", () => {
    const planned = t({ entry_price: 100, stop_loss: 95, take_profit: 115, status: "open" });
    expect(pendingReason("risk_reward_ratio", planned)).toBeUndefined();
  });
});
