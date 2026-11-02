import { describe, expect, it } from "vitest";
import { examplePlan, formatPlanText, PLAN_FIELDS } from "./trading-plan";

describe("formatPlanText", () => {
  it("is empty when nothing is filled in", () => {
    expect(formatPlanText({})).toBe("");
    expect(formatPlanText({ markets: "   " }, "Alex")).toBe("");
  });

  it("leaves out empty fields and empty sections", () => {
    const text = formatPlanText({ markets: "US stocks", maxPositions: "5" });
    expect(text).toBe(
      ["TRADING PLAN", "WHAT I TRADE\nMarkets: US stocks", "RISK\nMax open positions: 5"].join("\n\n"),
    );
  });

  it("puts a multi-line answer on its own indented lines", () => {
    const text = formatPlanText({ setups: "1. Breakout\n 2. Pullback " });
    expect(text).toContain("Setups:\n  1. Breakout\n  2. Pullback");
  });

  it("names the trader when given", () => {
    expect(formatPlanText({ markets: "Crypto" }, "  Sam ")).toMatch(/^TRADING PLAN: Sam\n/);
  });

  it("formats the full example with every field", () => {
    const text = formatPlanText(examplePlan());
    for (const field of PLAN_FIELDS) expect(text).toContain(field.label);
  });

  it("has unique field keys", () => {
    const keys = PLAN_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
