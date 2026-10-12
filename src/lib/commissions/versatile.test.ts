import { describe, expect, it } from "vitest";
import { componentFee, matchCommissionRule, resolveCommission } from "./calculate";
import {
  BLANK_CHARGE,
  BLANK_FORM,
  describeRule,
  formFromComponents,
  formFromRule,
  isSplit,
  payloadFromForm,
  previewRule,
  splitForm,
  tryIt,
  unsplitForm,
} from "./fee-form";
import { CUSTOM_TEMPLATES } from "./presets";
import type { CommissionRule, FeeComponent } from "./types";

const line = (over: Partial<FeeComponent>): FeeComponent => ({ label: "Commission", basis: "flat", amount: 1, side: "both", ...over });

describe("Alon's setup: $2.50 per action, buy fee from the shares", () => {
  const tpl = CUSTOM_TEMPLATES.find((t) => t.id === "custom-buy-from-shares")!;
  const rule = previewRule(formFromComponents(tpl.components));

  it("charges $2.50 to buy and $2.50 to sell, whatever the share count", () => {
    expect(tryIt(rule, 1, 80)).toMatchObject({ buy: 2.5, sell: 2.5, total: 5 });
    expect(tryIt(rule, 100, 80)).toMatchObject({ buy: 2.5, sell: 2.5, total: 5 });
  });

  it("covers the buy fee at $82.50 and breaks even at $85.00 on one share", () => {
    const r = tryIt(rule, 1, 80);
    expect(r.coverBuy).toBeCloseTo(82.5, 10);
    expect(r.breakeven).toBeCloseTo(85, 10);
  });

  it("says where each fee comes from", () => {
    const text = describeRule(rule);
    expect(text[0]).toBe("$2.50 when you buy, taken from the shares you buy");
    expect(text[1]).toBe("$2.50 when you sell");
  });
});

describe("size bands", () => {
  const tiered = line({ basis: "percent", amount: 0.1, tiers: [{ up_to: 10000, amount: 0.1 }, { up_to: null, amount: 0.05 }] });

  it("uses the band the trade's value falls in, for the whole trade", () => {
    expect(componentFee(tiered, "entry", 50, 100)).toBeCloseTo(5, 10); // $5,000 -> 0.1%
    expect(componentFee(tiered, "entry", 50, 1000)).toBeCloseTo(25, 10); // $50,000 -> 0.05%
  });

  it("can measure by share count", () => {
    const byShares = line({ basis: "flat", tiers: [{ up_to: 500, amount: 1 }, { up_to: null, amount: 3 }], tier_by: "shares" });
    expect(componentFee(byShares, "entry", 10, 400)).toBe(1);
    expect(componentFee(byShares, "entry", 10, 600)).toBe(3);
  });
});

describe("only when", () => {
  it("charges market orders only, and not trades with no order type", () => {
    const c = line({ basis: "per_unit", amount: 0.005, only_when: { order_types: ["market"] } });
    expect(componentFee(c, "entry", 10, 1000, "long", "market")).toBeCloseTo(5, 10);
    expect(componentFee(c, "entry", 10, 1000, "long", "limit")).toBe(0);
    expect(componentFee(c, "entry", 10, 1000, "long", null)).toBe(0);
  });

  it("charges shorts only", () => {
    const c = line({ only_when: { direction: "short" } });
    expect(componentFee(c, "entry", 10, 1, "short")).toBe(1);
    expect(componentFee(c, "entry", 10, 1, "long")).toBe(0);
  });

  it("charges cheap stocks only", () => {
    const c = line({ basis: "per_unit", amount: 0.005, only_when: { price_below: 1 } });
    expect(componentFee(c, "entry", 0.5, 1000)).toBeCloseTo(5, 10);
    expect(componentFee(c, "entry", 5, 1000)).toBe(0);
  });
});

describe("fees in another currency", () => {
  it("converts fixed amounts and limits at the stored rate; a % needs no rate", () => {
    const eur = line({ amount: 2, currency: "EUR", fx_rate: 1.1 });
    expect(componentFee(eur, "entry", 50, 10)).toBeCloseTo(2.2, 10);
    const pctWithMin = line({ basis: "percent", amount: 0.1, min_fee: 15, currency: "ILS", fx_rate: 0.27 });
    expect(componentFee(pctWithMin, "entry", 50, 10)).toBeCloseTo(15 * 0.27, 10); // 0.1% of $500 = $0.50 < ₪15 min
  });
});

describe("choosing the fee on a trade", () => {
  const rules = [
    { ...previewRule({ ...BLANK_FORM, name: "A", charges: [{ ...BLANK_CHARGE, amount: "1" }] }), id: "a", sort_order: 0 },
    { ...previewRule({ ...BLANK_FORM, name: "B", charges: [{ ...BLANK_CHARGE, amount: "7" }] }), id: "b", sort_order: 1, enabled: false },
  ] as CommissionRule[];
  const trade = { asset_type: null, market: null, status: "closed", direction: "long", entry_price: 10, exit_price: 11, shares: 1 };

  it("uses the chosen fee over matching, even one switched off", () => {
    expect(matchCommissionRule(rules, trade)?.id).toBe("a");
    expect(matchCommissionRule(rules, { ...trade, commission_rule_id: "b" })?.id).toBe("b");
    expect(resolveCommission(rules, { ...trade, commission_rule_id: "b" })).toBe(14);
  });

  it("falls back to matching when the chosen fee no longer exists", () => {
    expect(matchCommissionRule(rules, { ...trade, commission_rule_id: "gone" })?.id).toBe("a");
  });
});

describe("the form", () => {
  it("splits one fee into buy and sell and back", () => {
    const f = { ...BLANK_FORM, charges: [{ ...BLANK_CHARGE, amount: "2.5" }] };
    const split = splitForm(f);
    expect(isSplit(split)).toBe(true);
    expect(split.charges.map((c) => c.side)).toEqual(["buy", "sell"]);
    expect(unsplitForm(split, "both").charges).toHaveLength(1);
  });

  it("round-trips every new option through a save", () => {
    const comps: FeeComponent[] = [
      line({ tiers: [{ up_to: 500, amount: 1 }, { up_to: null, amount: 2 }], tier_by: "shares", only_when: { order_types: ["market"], direction: "short", price_below: 5 }, currency: "EUR", fx_rate: 1.1, fx_rate_date: "2026-09-29", taken_from: "shares", side: "buy" }),
    ];
    const rule = previewRule(formFromComponents(comps));
    expect(rule.components?.[0]).toMatchObject(comps[0]);
    expect(payloadFromForm(formFromRule(rule), true).components?.[0]).toMatchObject(comps[0]);
  });
});
