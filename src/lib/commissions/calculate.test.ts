import { describe, it, expect } from "vitest";
import {
  matchCommissionRule,
  sideFee,
  computeCommission,
  computeBreakevenPrice,
  resolveCommission,
  type CommissionTradeInput,
} from "./calculate";
import type { CommissionRule } from "./types";

function rule(over: Partial<CommissionRule> = {}): CommissionRule {
  return {
    id: "r1",
    user_id: "u1",
    name: "R",
    rule_type: "flat",
    amount: 2.5,
    applies_to: "both",
    asset_type: null,
    market: null,
    min_fee: null,
    max_fee: null,
    enabled: true,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function trade(over: Partial<CommissionTradeInput> = {}): CommissionTradeInput {
  return {
    asset_type: null,
    market: null,
    status: "closed",
    direction: "long",
    entry_price: 90,
    exit_price: 100,
    shares: 1,
    ...over,
  };
}

describe("the worked example this feature was built from", () => {
  // Buy 1 share at $90 with a $2.50-per-side fee: you don't profit until $95,
  // because the exit fee still has to be paid on the way out.
  it("puts break-even a full round trip above entry", () => {
    expect(computeBreakevenPrice(rule(), trade({ status: "open", exit_price: null }))).toBe(95);
  });

  it("charges only the entry side while the position is open", () => {
    expect(computeCommission(rule(), trade({ status: "open", exit_price: null })).total).toBe(2.5);
  });

  it("charges both sides once closed", () => {
    expect(computeCommission(rule(), trade()).total).toBe(5);
  });

  it("spreads a flat fee across the position, so more shares move break-even less", () => {
    expect(computeBreakevenPrice(rule(), trade({ shares: 10, status: "open" }))).toBe(90.5);
  });
});

describe("which sides get charged", () => {
  it("bills nothing on a pending order, which hasn't filled", () => {
    expect(computeCommission(rule(), trade({ status: "pending" })).total).toBe(0);
  });

  it("splits the breakdown into entry and exit", () => {
    expect(computeCommission(rule(), trade())).toEqual({ entryFee: 2.5, exitFee: 2.5, total: 5 });
  });

  it("honours an entry-only rule", () => {
    expect(computeCommission(rule({ applies_to: "entry" }), trade()).total).toBe(2.5);
  });

  it("honours an exit-only rule", () => {
    expect(computeCommission(rule({ applies_to: "exit" }), trade()).total).toBe(2.5);
    expect(computeCommission(rule({ applies_to: "exit" }), trade({ status: "open" })).total).toBe(0);
  });

  it("still counts an exit-only fee toward break-even while open", () => {
    expect(computeBreakevenPrice(rule({ applies_to: "exit" }), trade({ status: "open" }))).toBe(92.5);
  });
});

describe("rule types", () => {
  it("charges per share for per_unit rules", () => {
    const r = rule({ rule_type: "per_unit", amount: 0.005 });
    expect(sideFee(r, "entry", 90, 200)).toBe(1);
    expect(computeCommission(r, trade({ shares: 200 })).total).toBe(2);
    expect(computeBreakevenPrice(r, trade({ shares: 200, status: "open" }))).toBe(90.01);
  });

  it("charges a percent of notional", () => {
    expect(sideFee(rule({ rule_type: "percent", amount: 1 }), "entry", 100, 1)).toBe(1);
  });

  // The exit fee depends on the exit price, which is the number being solved
  // for -- so this is checked by substituting the answer back in.
  it("solves the self-referential break-even for a percent fee (long)", () => {
    const pct = rule({ rule_type: "percent", amount: 1 });
    const t = trade({ entry_price: 100, shares: 1, status: "open" });
    const breakeven = computeBreakevenPrice(pct, t)!;
    expect(breakeven).toBeCloseTo(101 / 0.99, 9);

    const gross = (breakeven - 100) * 1;
    const fees = sideFee(pct, "entry", 100, 1) + sideFee(pct, "exit", breakeven, 1);
    expect(gross).toBeCloseTo(fees, 9);
  });

  it("solves it for a short too", () => {
    const pct = rule({ rule_type: "percent", amount: 1 });
    const t = trade({ entry_price: 100, shares: 1, direction: "short", status: "open" });
    const breakeven = computeBreakevenPrice(pct, t)!;
    expect(breakeven).toBeCloseTo(99 / 1.01, 9);

    const gross = (100 - breakeven) * 1;
    const fees = sideFee(pct, "entry", 100, 1) + sideFee(pct, "exit", breakeven, 1);
    expect(gross).toBeCloseTo(fees, 9);
  });

  it("puts a short's break-even below its entry", () => {
    expect(computeBreakevenPrice(rule(), trade({ direction: "short", status: "open" }))).toBe(85);
  });
});

describe("min/max clamping", () => {
  const clamped = rule({ rule_type: "percent", amount: 0.1, min_fee: 1, max_fee: 5 });

  it("raises a small fee to the floor", () => {
    expect(sideFee(clamped, "entry", 100, 1)).toBe(1); // 0.1% of 100 = 0.10
  });

  it("caps a large one", () => {
    expect(sideFee(clamped, "entry", 100000, 1)).toBe(5); // 0.1% of 100k = 100
  });

  it("leaves a mid-range fee alone", () => {
    expect(sideFee(clamped, "entry", 2000, 1)).toBe(2);
  });

  it("solves break-even correctly while pinned at the floor", () => {
    // Behaves exactly like a $1 flat fee once clamped.
    expect(computeBreakevenPrice(clamped, trade({ entry_price: 100, shares: 1, status: "open" }))).toBe(102);
  });
});

describe("matching a rule to a trade", () => {
  const crypto = rule({ id: "crypto", asset_type: "crypto", sort_order: 0 });
  const catchAll = rule({ id: "all", asset_type: null, sort_order: 10 });
  const rules = [catchAll, crypto];

  it("prefers a scoped rule over a catch-all, by sort order", () => {
    expect(matchCommissionRule(rules, { asset_type: "crypto", market: null })?.id).toBe("crypto");
  });

  it("falls back to the catch-all", () => {
    expect(matchCommissionRule(rules, { asset_type: "stock", market: null })?.id).toBe("all");
  });

  it("matches case-insensitively", () => {
    expect(matchCommissionRule(rules, { asset_type: "CRYPTO", market: null })?.id).toBe("crypto");
  });

  it("skips disabled rules", () => {
    expect(matchCommissionRule([{ ...crypto, enabled: false }], { asset_type: "crypto", market: null })).toBeNull();
  });

  it("scopes by market", () => {
    const nasdaq = rule({ id: "nq", market: "NASDAQ" });
    expect(matchCommissionRule([nasdaq], { asset_type: null, market: "nasdaq" })?.id).toBe("nq");
    expect(matchCommissionRule([nasdaq], { asset_type: null, market: "NYSE" })).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(matchCommissionRule([], { asset_type: "x", market: null })).toBeNull();
    expect(computeCommission(null, trade()).total).toBe(0);
    expect(computeBreakevenPrice(null, trade())).toBeNull();
  });
});

describe("missing data never guesses", () => {
  it("has no break-even without an entry price or share count", () => {
    expect(computeBreakevenPrice(rule(), trade({ shares: null }))).toBeNull();
    expect(computeBreakevenPrice(rule(), trade({ entry_price: null }))).toBeNull();
    expect(computeBreakevenPrice(rule(), trade({ shares: 0 }))).toBeNull();
  });

  it("returns a zero fee rather than a guess when inputs are missing", () => {
    expect(sideFee(rule({ rule_type: "percent", amount: 1 }), "entry", null, 1)).toBe(0);
    expect(sideFee(rule({ rule_type: "per_unit", amount: 1 }), "entry", 90, null)).toBe(0);
  });

  it("still charges a flat fee, which needs neither price nor size", () => {
    expect(sideFee(rule(), "entry", null, null)).toBe(2.5);
  });

  it("reports no break-even when fees exceed the whole position", () => {
    // A short can't break even below $0.
    expect(computeBreakevenPrice(rule({ amount: 1000 }), trade({ direction: "short", status: "open" }))).toBeNull();
  });

  it("never turns a negative share count into a negative fee", () => {
    expect(sideFee(rule({ rule_type: "per_unit", amount: 0.01 }), "entry", 90, -100)).toBe(1);
  });
});

describe("resolveCommission — what actually gets stored", () => {
  const rules = [rule()];

  // Both of these were real bugs, caught only by running against the live
  // database rather than by reading the code.
  it("never charges an investment trade, which has no entry price to charge against", () => {
    expect(resolveCommission(rules, trade({ mode: "investment", status: "open" }))).toBeNull();
  });

  it("stores null, not 0, for a pending order — nothing has been paid yet", () => {
    expect(resolveCommission(rules, trade({ status: "pending" }))).toBeNull();
  });

  it("stores null when no rule matches", () => {
    expect(resolveCommission([], trade())).toBeNull();
  });

  it("charges the entry side once open and both once closed", () => {
    expect(resolveCommission(rules, trade({ status: "open" }))).toBe(2.5);
    expect(resolveCommission(rules, trade())).toBe(5);
  });

  it("treats an absent mode as a normal trade", () => {
    expect(resolveCommission(rules, trade({ mode: undefined }))).toBe(5);
  });
});
