import { describe, expect, it } from "vitest";
import {
  componentFee,
  computeBreakevenPrice,
  computeCommission,
  computeEntryCoverPrice,
  feeLines,
  sideFee,
  type CommissionTradeInput,
} from "./calculate";
import { BROKER_PRESETS, findPreset } from "./presets";
import { commissionRuleSchema } from "./schema";
import type { CommissionRule, FeeComponent } from "./types";

function rule(over: Partial<CommissionRule> = {}): CommissionRule {
  return {
    id: "r1",
    user_id: "u1",
    name: "R",
    rule_type: "flat",
    amount: 0,
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
    entry_price: 80,
    exit_price: 90,
    shares: 1,
    ...over,
  };
}

const commissionOnly = (id: string) => rule({ components: findPreset(id)!.components.filter((c) => c.label === "Commission") });

describe("IBKR Pro Fixed, against IBKR's own published examples", () => {
  const ibkr = commissionOnly("ibkr-pro-fixed-stocks");
  it("100 shares @ $25 = $1.00 (the minimum)", () => {
    expect(sideFee(ibkr, "entry", 25, 100)).toBeCloseTo(1.0, 10);
  });
  it("1,000 shares @ $25 = $5.00", () => {
    expect(sideFee(ibkr, "entry", 25, 1000)).toBeCloseTo(5.0, 10);
  });
  it("1,000 shares @ $0.25 = $2.50 (capped at 1% of trade value)", () => {
    expect(sideFee(ibkr, "entry", 0.25, 1000)).toBeCloseTo(2.5, 10);
  });
});

describe("regulatory fees follow the SELL, not the exit", () => {
  const regs = rule({ components: findPreset("ibkr-lite-stocks")!.components });

  it("a long pays the SEC fee and TAF when it exits", () => {
    // 1,000 shares sold at $50: SEC 0.00206% of $50,000 = $1.03; TAF $0.195; CAT $0.003.
    expect(sideFee(regs, "entry", 50, 1000, "long")).toBeCloseTo(0.003, 10);
    expect(sideFee(regs, "exit", 50, 1000, "long")).toBeCloseTo(1.03 + 0.195 + 0.003, 10);
  });

  it("a short pays them when it enters -- the entry is the sell", () => {
    expect(sideFee(regs, "entry", 50, 1000, "short")).toBeCloseTo(1.03 + 0.195 + 0.003, 10);
    expect(sideFee(regs, "exit", 50, 1000, "short")).toBeCloseTo(0.003, 10);
  });

  it("caps FINRA's TAF at $9.79", () => {
    const taf: FeeComponent = findPreset("ibkr-lite-stocks")!.components.find((c) => c.label === "FINRA TAF")!;
    expect(componentFee(taf, "exit", 10, 1_000_000, "long")).toBeCloseTo(9.79, 10);
  });
});

describe("the break-even you asked for: $2.50 a side, bought at $80", () => {
  const flat = rule({ components: [{ label: "Commission", basis: "flat", amount: 2.5, side: "both" }] });

  it("on 1 share the buy fee is covered at $82.50 and both fees at $85.00", () => {
    expect(computeEntryCoverPrice(flat, trade())).toBeCloseTo(82.5, 10);
    expect(computeBreakevenPrice(flat, trade())).toBeCloseTo(85, 10);
  });

  it("on 100 shares the same fees move the price by cents", () => {
    expect(computeEntryCoverPrice(flat, trade({ shares: 100 }))).toBeCloseTo(80.025, 10);
    expect(computeBreakevenPrice(flat, trade({ shares: 100 }))).toBeCloseTo(80.05, 10);
  });

  it("a closed trade pays both sides; an open one only the buy", () => {
    expect(computeCommission(flat, trade()).total).toBe(5);
    expect(computeCommission(flat, trade({ status: "open" })).total).toBe(2.5);
  });
});

describe("feeLines", () => {
  it("names every line of a multi-line rule", () => {
    const r = rule({ components: findPreset("ibkr-pro-fixed-stocks")!.components });
    expect(feeLines(r, "exit", 25, 100).map((l) => l.label)).toEqual(["Commission", "SEC fee", "FINRA TAF", "CAT fee"]);
  });

  it("reports a single-line rule as one line under the rule's name", () => {
    expect(feeLines(rule({ name: "Flat", amount: 2.5 }), "entry", 80, 1)).toEqual([{ label: "Flat", fee: 2.5 }]);
  });
});

describe("tastytrade options: $1 to open, capped at $10 a leg, free to close", () => {
  const tasty = rule({ components: findPreset("tastytrade-options")!.components });
  it("charges the entry only, capped", () => {
    expect(sideFee(tasty, "entry", 2, 5)).toBe(5);
    expect(sideFee(tasty, "entry", 2, 25)).toBe(10);
    expect(sideFee(tasty, "exit", 2, 25)).toBe(0);
  });
});

describe("BROKER_PRESETS", () => {
  it("has unique ids and a source on every preset", () => {
    expect(new Set(BROKER_PRESETS.map((p) => p.id)).size).toBe(BROKER_PRESETS.length);
    for (const p of BROKER_PRESETS) expect(p.source).toMatch(/^https:\/\//);
  });

  it("every preset saves through the same validator a user's rule does", () => {
    for (const p of BROKER_PRESETS) {
      const parsed = commissionRuleSchema.safeParse({
        name: `${p.broker} ${p.plan}`.slice(0, 80),
        rule_type: "flat",
        amount: 0,
        applies_to: "both",
        asset_type: p.asset_type,
        market: null,
        min_fee: null,
        max_fee: null,
        enabled: true,
        components: p.components.length > 0 ? p.components : null,
        preset_id: p.id,
      });
      expect(parsed.success, p.id).toBe(true);
    }
  });
});
