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
  hasCommissionRule: false,
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

  // Regression: exit price being the reported cause used to fire whenever
  // it was among the missing fields, even when entry price or shares were
  // ALSO missing on the same open trade -- silently dropping those from the
  // message and implying closing the trade was the only remaining step.
  it("doesn't let 'once it closes' hide that entry price or shares are also missing", () => {
    expect(pendingReason("dollar_pl", t({ shares: 10 }))).toBe("Add an entry price and an exit price");
    expect(pendingReason("dollar_pl", t({ entry_price: 100 }))).toBe("Add an exit price and a share count");
    expect(pendingReason("dollar_pl", t())).toBe("Add an entry price, an exit price and a share count");
  });
});

// Regression: these two used to fall straight through to needsPL()'s raw
// text, so an open trade missing only its exit price showed "Add an exit
// price" right next to Dollar P/L's "Once the trade closes" -- the exact
// contradiction that field was written to avoid, just not applied to its
// neighbors.
describe("percent return and R multiple inherit the same 'awaiting close' wording", () => {
  it("percent return", () => {
    expect(pendingReason("percent_return", t({ entry_price: 100, shares: 10 }))).toBe("Once the trade closes");
    expect(pendingReason("percent_return", t({ shares: 10 }))).toBe("Add an entry price and an exit price");
  });

  it("R multiple", () => {
    expect(pendingReason("r_multiple", t({ entry_price: 100, shares: 10, risk_amount: 50 }))).toBe(
      "Once the trade closes",
    );
    expect(pendingReason("r_multiple", t({ shares: 10, risk_amount: 50 }))).toBe(
      "Add an entry price and an exit price",
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

  // Regression: risk_amount computing to exactly 0 (stop set equal to
  // entry) is a *present* value, not a missing one -- missing() doesn't
  // catch it, so this silently fell through to a bare, unexplained dash.
  it("explains a risk amount of exactly zero instead of going silently blank", () => {
    const closed = t({ entry_price: 100, exit_price: 110, shares: 10, risk_amount: 0, status: "closed" });
    expect(pendingReason("r_multiple", closed)).toBe("Your stop loss is the same as your entry price");
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

  // Same zero-denominator case as R multiple, mirroring compute.ts's
  // `risk !== 0` guard (entry_price === stop_loss).
  it("explains a stop loss equal to entry price instead of going silently blank", () => {
    const degenerate = t({ entry_price: 100, stop_loss: 100, take_profit: 115 });
    expect(pendingReason("risk_reward_ratio", degenerate)).toBe("Your stop loss is the same as your entry price");
  });
});

describe("breakeven price", () => {
  it("needs entry price and a share count", () => {
    expect(pendingReason("breakeven_price", t({ shares: 10 }))).toBe("Add an entry price");
    expect(pendingReason("breakeven_price", t({ entry_price: 100 }))).toBe("Add a share count");
  });

  it("explains a share count of exactly zero", () => {
    expect(pendingReason("breakeven_price", t({ entry_price: 100, shares: 0 }))).toBe("Add a share count");
  });

  // Regression: previously this field's pending text unconditionally blamed
  // "no commission" whenever entry price was present, even when the real
  // cause was a missing share count -- wrong message for the common case of
  // a trade with a price but no size yet.
  it("blames the actual cause, not always 'no commission'", () => {
    expect(pendingReason("breakeven_price", t({ entry_price: 100 }))).not.toMatch(/commission/i);
  });

  it("blames the missing rule once entry price and shares are both present", () => {
    expect(pendingReason("breakeven_price", t({ entry_price: 100, shares: 10 }))).toBe(
      "No matching rule — add one on the Commissions page",
    );
  });

  it("says nothing once a rule matches and the inputs are complete", () => {
    expect(
      pendingReason("breakeven_price", t({ entry_price: 100, shares: 10, hasCommissionRule: true })),
    ).toBeUndefined();
  });
});

describe("commission", () => {
  it("blames the missing rule", () => {
    expect(pendingReason("commission", t())).toBe("No matching rule — add one on the Commissions page");
  });

  // resolveCommission (calculate.ts) returns null for a pending trade even
  // when a rule matches -- the entry fee isn't charged until it opens.
  it("explains a matched rule that hasn't charged anything yet", () => {
    expect(pendingReason("commission", t({ hasCommissionRule: true, status: "pending" }))).toBe(
      "Nothing charged on this trade yet",
    );
  });

  it("says nothing once a rule matches on an open or closed trade", () => {
    expect(pendingReason("commission", t({ hasCommissionRule: true, status: "open" }))).toBeUndefined();
    expect(pendingReason("commission", t({ hasCommissionRule: true, status: "closed" }))).toBeUndefined();
  });
});
