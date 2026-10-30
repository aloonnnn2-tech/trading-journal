import { describe, expect, it } from "vitest";
import type { Trade } from "@/lib/trades/types";
import { evaluateOverallRules, isFresh, ruleApplies, staleMarketRules, tally, type StoredCheck } from "./evaluate";
import { describePeriodAdherence, periodAdherence } from "./month";
import { overallRuleSchema } from "./schema";
import type { OverallRule } from "./types";

function rule(over: Partial<OverallRule> = {}): OverallRule {
  return {
    id: "r1",
    label: "Risk 1% or less",
    kind: "field",
    subject_source: "core",
    subject_key: "risk_percent",
    operator: "lte",
    number_value: 1,
    number_value_max: null,
    text_value: null,
    ma_type: null,
    ma_period: null,
    ma_type_2: null,
    ma_period_2: null,
    entry_template: null,
    grace_days: 1,
    direction: "both",
    enabled: true,
    sort_order: 0,
    updated_at: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

const smaExit = rule({ id: "r2", label: "Exit below SMA 150", kind: "ma_exit", subject_source: null, subject_key: null, operator: null, number_value: null, ma_type: "sma", ma_period: 150 });
const words = rule({ id: "r3", label: "No trades in the first 15 minutes", kind: "text", subject_source: null, subject_key: null, operator: null, number_value: null });

function trade(over: Partial<Trade> = {}): Trade {
  return {
    id: "t1",
    mode: "trade",
    ticker: "AAPL",
    direction: "long",
    status: "closed",
    risk_percent: 0.8,
    dollar_pl: 200,
    r_multiple: 1,
    entry_date: "2026-10-02",
    exit_date: "2026-10-10",
    custom_fields: {},
    strategy_field_values: {},
    updated_at: "2026-10-10T00:00:00.000Z",
    ...over,
  } as Trade;
}

function stored(over: Partial<StoredCheck> = {}): StoredCheck {
  return {
    trade_id: "t1",
    rule_id: "r2",
    outcome: "broken",
    detail: { summary: "Closed below the SMA 150 on Oct 3.", cost: 120 },
    trade_updated_at: "2026-10-10T00:00:00.000Z",
    rule_updated_at: "2026-10-01T00:00:00.000Z",
    computed_at: "2026-10-11T00:00:00.000Z",
    ...over,
  };
}

describe("evaluateOverallRules", () => {
  it("judges field rules live, reads moving-average results, leaves text rules to the AI", () => {
    const checks = evaluateOverallRules({ trade: trade(), rules: [rule(), smaExit, words], adjustments: null, stored: [stored()] });
    expect(checks.map((c) => [c.rule.id, c.outcome])).toEqual([
      ["r1", "followed"],
      ["r2", "broken"],
      ["r3", "ai"],
    ]);
    expect(checks[0].detail.summary).toBe("Was 0.8.");
  });

  it("a field rule broken, and one with nothing to check", () => {
    expect(evaluateOverallRules({ trade: trade({ risk_percent: 2 }), rules: [rule()], adjustments: null, stored: [] })[0].outcome).toBe("broken");
    expect(evaluateOverallRules({ trade: trade({ risk_percent: null }), rules: [rule()], adjustments: null, stored: [] })[0].outcome).toBe("unevaluable");
  });

  it("doesn't trust a stale stored result", () => {
    const [, sma] = evaluateOverallRules({
      trade: trade({ updated_at: "2026-10-12T00:00:00.000Z" }),
      rules: [rule(), smaExit],
      adjustments: null,
      stored: [stored()],
    });
    expect(sma.outcome).toBe("unevaluable");
    expect(sma.detail.summary).toBe("Not checked against prices yet.");
  });

  it("skips rules that don't apply: switched off, the other direction, investments, pending orders", () => {
    expect(ruleApplies(rule({ enabled: false }), trade())).toBe(false);
    expect(ruleApplies(rule({ direction: "short" }), trade())).toBe(false);
    expect(ruleApplies(rule({ direction: "long" }), trade())).toBe(true);
    expect(ruleApplies(rule(), trade({ mode: "investment" }))).toBe(false);
    expect(ruleApplies(rule(), trade({ status: "pending" }))).toBe(false);
  });

  it("tallies a trade", () => {
    const checks = evaluateOverallRules({ trade: trade(), rules: [rule(), smaExit, words], adjustments: null, stored: [stored()] });
    expect(tally(checks)).toMatchObject({ followed: 1, broken: 1, ai: 1, score: 0.5 });
  });
});

describe("freshness", () => {
  it("is stale when the trade or the rule changed", () => {
    expect(isFresh(stored(), trade(), smaExit)).toBe(true);
    expect(isFresh(stored(), trade({ updated_at: "2026-10-12T00:00:00.000Z" }), smaExit)).toBe(false);
    expect(isFresh(stored(), trade(), { updated_at: "2026-10-05T00:00:00.000Z" })).toBe(false);
  });

  it("an open trade's result goes stale after a few hours (new closes)", () => {
    const now = Date.parse("2026-10-11T10:00:00.000Z");
    expect(isFresh(stored(), trade({ status: "open" }), smaExit, now)).toBe(false);
    expect(isFresh(stored({ computed_at: "2026-10-11T08:00:00.000Z" }), trade({ status: "open" }), smaExit, now)).toBe(true);
  });

  it("lists only the moving-average rules that need work", () => {
    expect(staleMarketRules(trade(), [rule(), smaExit, words], [stored()])).toEqual([]);
    expect(staleMarketRules(trade(), [rule(), smaExit, words], []).map((r) => r.id)).toEqual(["r2"]);
  });
});

describe("periodAdherence", () => {
  const rules = [rule(), smaExit, words];
  const rows = [
    // Kept both: +200.
    { trade: trade({ id: "a", dollar_pl: 200, r_multiple: 1 }), sma: stored({ trade_id: "a", outcome: "followed", detail: { summary: "ok" } }) },
    // Broke the SMA exit: -300, cost 120.
    { trade: trade({ id: "b", ticker: "NVDA", dollar_pl: -300, r_multiple: -1.5 }), sma: stored({ trade_id: "b" }) },
    // SMA never crossed; broke the risk rule.
    { trade: trade({ id: "c", risk_percent: 2, dollar_pl: 50, r_multiple: 0.25 }), sma: stored({ trade_id: "c", outcome: "not_triggered", detail: { summary: "never" } }) },
  ].map(({ trade: t, sma }) => ({
    trade: t,
    checks: evaluateOverallRules({ trade: t, rules, adjustments: null, stored: [{ ...sma, trade_updated_at: t.updated_at }] }),
  }));

  it("counts each rule, compares followed with broken, and adds up the cost", () => {
    const p = periodAdherence(rules, rows);
    expect(p.tradesJudged).toBe(3);
    expect(p.tradesClean).toBe(1);
    const [risk, sma] = p.rules;
    expect(risk).toMatchObject({ followed: 2, broken: 1, adherence: 2 / 3, brokenAvgPl: 50 });
    expect(risk.followedAvgPl).toBe(-50); // (200 - 300) / 2
    expect(sma).toMatchObject({ followed: 1, broken: 1, notTriggered: 1, adherence: 0.5, followedAvgPl: 200, brokenAvgPl: -300, brokenCost: 120 });
    expect(sma.brokenTrades).toEqual([
      { tradeId: "b", ticker: "NVDA", date: "2026-10-10", summary: "Closed below the SMA 150 on Oct 3.", cost: 120 },
    ]);
    expect(p.textRules.map((r) => r.id)).toEqual(["r3"]);
  });

  it("writes the AI's section with the numbers and the text rules to judge", () => {
    const text = describePeriodAdherence(periodAdherence(rules, rows)).join("\n");
    expect(text).toContain("Trades judged against at least one rule: 3; broke none: 1 (33%)");
    expect(text).toContain('"Exit below SMA 150": followed 1, broken 1, not triggered 1, couldn\'t check 0; adherence 50%');
    expect(text).toContain("cost of breaking it $120.00");
    expect(text).toContain('2026-10-10 NVDA broke "Exit below SMA 150": Closed below the SMA 150 on Oct 3.');
    expect(text).toContain('- "No trades in the first 15 minutes"');
  });

  it("caps the trade-by-trade list", () => {
    const many = Array.from({ length: 200 }, () => rows[1]).map((r, i) => ({ ...r, trade: { ...r.trade, id: `x${i}` } }));
    const text = describePeriodAdherence(periodAdherence(rules, many), 1_500).join("\n");
    expect(text.length).toBeLessThan(2_000);
    expect(text).toMatch(/\(\d+ more not listed\)/);
  });
});

describe("overallRuleSchema", () => {
  it("accepts each kind with what it needs, and drops other kinds' columns", () => {
    const exit = overallRuleSchema.parse({ kind: "ma_exit", label: "Exit below SMA 150", ma_type: "sma", ma_period: 150, number_value: 5 });
    expect(exit).toMatchObject({ kind: "ma_exit", ma_period: 150, grace_days: 1, number_value: null, direction: "both" });
    expect(overallRuleSchema.safeParse({ kind: "text", label: "No revenge trades" }).success).toBe(true);
    expect(
      overallRuleSchema.safeParse({ kind: "field", label: "Risk", subject_source: "core", subject_key: "risk_percent", operator: "lte", number_value: 1 }).success,
    ).toBe(true);
  });

  it.each([
    ["an exit rule without days", { kind: "ma_exit", label: "x", ma_type: "sma" }],
    ["a period over 400", { kind: "ma_exit", label: "x", ma_type: "sma", ma_period: 500 }],
    ["a cross rule comparing an average with itself", { kind: "ma_entry", label: "x", entry_template: "ma_above_ma", ma_type: "sma", ma_period: 50, ma_type_2: "sma", ma_period_2: 50 }],
    ["a field rule without a value", { kind: "field", label: "x", subject_source: "core", subject_key: "risk_percent", operator: "lte" }],
    ["an empty rule", { kind: "text", label: "  " }],
    ["a control character", { kind: "text", label: "a\u0000b" }],
    ["an unknown key", { kind: "text", label: "ok", user_id: "someone" }],
  ])("refuses %s", (_name, body) => {
    expect(overallRuleSchema.safeParse(body).success).toBe(false);
  });
});
