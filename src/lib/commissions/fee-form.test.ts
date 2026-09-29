import { describe, expect, it } from "vitest";
import {
  BLANK_FORM,
  describeRule,
  describeScope,
  exampleCost,
  formFromComponents,
  formFromRule,
  formatFee,
  payloadFromForm,
  previewRule,
  suggestName,
  tryIt,
  type FeeForm,
} from "./fee-form";
import { findPreset } from "./presets";
import type { CommissionRule } from "./types";

const form = (over: Partial<FeeForm> = {}): FeeForm => ({ ...BLANK_FORM, ...over });
const flat = (amount: string, extra: Partial<FeeForm["charges"][0]> = {}) => ({
  ...BLANK_FORM.charges[0],
  amount,
  ...extra,
});

describe("payloadFromForm", () => {
  it("saves one plain charge as a single-line rule, so it works before migration 0055", () => {
    const p = payloadFromForm(form({ name: "Stocks", charges: [flat("2.5")] }), true);
    expect(p).toMatchObject({ rule_type: "flat", amount: 2.5, applies_to: "both", components: null });
  });

  it("saves several charges, or a buy/sell charge, as components", () => {
    const ibkr = findPreset("ibkr-pro-fixed-stocks")!;
    const p = payloadFromForm(formFromComponents(ibkr.components, { preset_id: ibkr.id }), true);
    expect(p.components).toHaveLength(4);
    expect(p.preset_id).toBe("ibkr-pro-fixed-stocks");
  });

  it("fills in a name when the user left it blank", () => {
    expect(payloadFromForm(form({ charges: [flat("2.5")] }), true).name).toBe("$2.50 a trade");
  });

  it("round-trips a stored rule through the form unchanged", () => {
    const rule = previewRule(form({ name: "Crypto", asset_type: "Crypto", charges: [flat("0.1", { basis: "percent" })] }));
    const again = payloadFromForm(formFromRule(rule), true);
    expect(again).toMatchObject({ name: "Crypto", asset_type: "Crypto", rule_type: "percent", amount: 0.1 });
  });
});

describe("describeRule", () => {
  it("says a fee the way a trader would", () => {
    const rule = previewRule(form({ charges: [flat("1")] }));
    expect(describeRule(rule)).toEqual(["$1.00 when you buy and when you sell"]);
  });

  it("names each extra charge and its limits", () => {
    const rule = previewRule(formFromComponents(findPreset("ibkr-pro-fixed-stocks")!.components));
    expect(describeRule(rule)[0]).toBe(
      "$0.005 a share when you buy and when you sell (at least $1.00, at most 1% of the trade)",
    );
    expect(describeRule(rule)[1]).toBe("SEC fee: 0.00206% of the trade on sells");
    expect(describeRule(rule)[2]).toContain("FINRA TAF: $0.000195 a share on sells");
  });

  it("says 'No fees' for a commission-free rule", () => {
    expect(describeRule(previewRule(formFromComponents([])))).toEqual(["No fees"]);
  });
});

describe("the worked examples", () => {
  it("prices the list's example trade: 100 shares at $50", () => {
    const rule = previewRule(form({ charges: [flat("1")] }));
    expect(exampleCost(rule)).toEqual({ buy: 1, sell: 1, total: 2 });
  });

  it("gives Alon's example in the calculator: $2.50 a side, 1 share at $80", () => {
    const r = tryIt(previewRule(form({ charges: [flat("2.5")] })), 1, 80);
    expect(r.total).toBe(5);
    expect(r.coverBuy).toBeCloseTo(82.5, 10);
    expect(r.breakeven).toBeCloseTo(85, 10);
  });
});

describe("small helpers", () => {
  it("formats tiny per-share rates without rounding them away", () => {
    expect(formatFee(0.000195)).toBe("$0.000195");
    expect(formatFee(0.005)).toBe("$0.005");
    expect(formatFee(2.5)).toBe("$2.50");
  });

  it("suggests a name from the answers", () => {
    expect(suggestName(form({ asset_type: "Crypto", charges: [flat("0.1", { basis: "percent" })] }))).toBe(
      "Crypto: 0.1% of the trade",
    );
  });

  it("describes scope", () => {
    expect(describeScope({ asset_type: null, market: null } as CommissionRule)).toBe("All trades");
    expect(describeScope({ asset_type: "Option", market: null } as CommissionRule)).toBe("Option trades only");
  });
});
