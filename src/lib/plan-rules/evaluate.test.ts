import { describe, expect, it } from "vitest";
import type { Trade } from "@/lib/trades/types";
import type { TradeAdjustments } from "@/lib/trades/adjustments";
import { evaluateStrategyRules } from "./evaluate";
import type { RuleOperator, StrategyRule, SubjectSource } from "./types";

// The property this whole feature rests on: **a missing value is not a
// violation.** A rule about risk % on a trade where risk was never recorded
// has not been broken -- there is nothing to check. Getting that wrong would
// turn incomplete logging into a discipline problem and put a number on screen
// that means something other than what it says.

const STRATEGY_ID = "strat-1";

function trade(over: Partial<Trade> = {}): Trade {
  return {
    id: "t1",
    user_id: "u1",
    mode: "trade",
    ticker: "NVDA",
    company_name: null,
    asset_type: "stock",
    market: "US",
    direction: "long",
    status: "closed",
    result: "win",
    entry_price: 100,
    exit_price: 110,
    stop_loss: 95,
    take_profit: 115,
    shares: 10,
    position_size: 1000,
    dollar_amount: null,
    risk_amount: 50,
    risk_percent: 0.8,
    entry_date: "2026-08-10T13:30:00Z",
    exit_date: "2026-08-14T19:00:00Z",
    commission: 2,
    commission_manual: false,
    dollar_pl: 98,
    percent_return: 9.8,
    r_multiple: 2.6,
    risk_reward_ratio: 3,
    custom_fields: {},
    strategy_field_values: {},
    created_at: "2026-08-10T13:30:00Z",
    updated_at: "2026-08-14T19:05:00Z",
    ...over,
  } as Trade;
}

function rule(over: Partial<StrategyRule> = {}): StrategyRule {
  return {
    id: `r-${Math.random()}`,
    strategy_id: STRATEGY_ID,
    label: "A rule",
    subject_source: "core" as SubjectSource,
    subject_key: "risk_percent",
    operator: "lte" as RuleOperator,
    number_value: 1,
    number_value_max: null,
    text_value: null,
    enabled: true,
    sort_order: 0,
    ...over,
  };
}

const noAdjustments: TradeAdjustments = {
  stopMoved: false,
  targetMoved: false,
  adjustments: [],
  hasHistory: true,
  mayBeTruncated: false,
};

function run(rules: StrategyRule[], t: Trade = trade(), adjustments = noAdjustments) {
  return evaluateStrategyRules(
    { trade: t, strategyId: STRATEGY_ID, rules, adjustments },
    "Breakout",
  );
}

describe("evaluateStrategyRules — scoring", () => {
  it("scores passes over checkable rules", () => {
    const result = run([
      rule({ subject_key: "risk_percent", operator: "lte", number_value: 1 }), // 0.8 ✅
      rule({ subject_key: "risk_reward_ratio", operator: "gte", number_value: 2 }), // 3 ✅
      rule({ subject_key: "r_multiple", operator: "gte", number_value: 5 }), // 2.6 ❌
    ]);

    expect(result.passed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.score).toBeCloseTo(2 / 3);
  });

  it("drops disabled rules entirely rather than reporting them as skipped", () => {
    // A rule the trader switched off is not part of the plan right now.
    const result = run([
      rule({ operator: "lte", number_value: 1 }),
      rule({ operator: "gte", number_value: 99, enabled: false }),
    ]);
    expect(result.evaluations).toHaveLength(1);
    expect(result.score).toBe(1);
  });

  it("returns a null score when nothing was checkable, not zero", () => {
    // 0% reads as total failure. "—" is the truth.
    const result = run([rule({ subject_key: "risk_percent" })], trade({ risk_percent: null }));
    expect(result.unevaluable).toBe(1);
    expect(result.score).toBeNull();
  });

  it("keeps unevaluable rules out of the denominator", () => {
    const result = run(
      [
        rule({ subject_key: "risk_percent", operator: "lte", number_value: 1 }), // ✅
        rule({ subject_key: "r_multiple", operator: "gte", number_value: 99 }), // ❌
        rule({ subject_key: "dollar_amount", operator: "lte", number_value: 1 }), // not recorded
      ],
      trade({ dollar_amount: null }),
    );

    expect(result.passed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.unevaluable).toBe(1);
    // 1/2, not 1/3 -- the unrecorded field is not a violation.
    expect(result.score).toBe(0.5);
  });

  it("explains why a rule could not be evaluated", () => {
    const result = run([rule({ subject_key: "risk_percent" })], trade({ risk_percent: null }));
    expect(result.evaluations[0].reason).toBe("Not recorded on this trade.");
    expect(result.evaluations[0].actual).toBeNull();
  });
});

describe("evaluateStrategyRules — numeric operators", () => {
  const cases: [RuleOperator, number, number, "pass" | "fail"][] = [
    ["lte", 0.8, 1, "pass"],
    ["lte", 1, 1, "pass"],
    ["lt", 1, 1, "fail"],
    ["gte", 3, 2, "pass"],
    ["gt", 2, 2, "fail"],
    ["eq", 2, 2, "pass"],
    ["neq", 2, 2, "fail"],
  ];

  for (const [operator, actual, target, expected] of cases) {
    it(`${operator}: ${actual} vs ${target} → ${expected}`, () => {
      const result = run(
        [rule({ subject_key: "risk_percent", operator, number_value: target })],
        trade({ risk_percent: actual }),
      );
      expect(result.evaluations[0].outcome).toBe(expected);
    });
  }

  it("treats between as inclusive at both ends", () => {
    // "Hold 3-7 days" means a 3-day hold complies.
    for (const days of [3, 5, 7]) {
      const result = run(
        [
          rule({
            subject_source: "derived",
            subject_key: "holding_days",
            operator: "between",
            number_value: 3,
            number_value_max: 7,
          }),
        ],
        trade({
          entry_date: "2026-08-10T00:00:00Z",
          exit_date: new Date(Date.UTC(2026, 7, 10 + days)).toISOString(),
        }),
      );
      expect(result.evaluations[0].outcome).toBe("pass");
    }
  });

  it("tolerates a reversed between range", () => {
    const result = run([
      rule({
        subject_key: "risk_percent",
        operator: "between",
        number_value: 2,
        number_value_max: 0.5,
      }),
    ]);
    expect(result.evaluations[0].outcome).toBe("pass"); // 0.8 is within 0.5–2
  });

  it("is unevaluable when between has no upper bound", () => {
    const result = run([
      rule({ operator: "between", number_value: 1, number_value_max: null }),
    ]);
    expect(result.evaluations[0].outcome).toBe("unevaluable");
  });
});

describe("evaluateStrategyRules — zero and false are recorded answers", () => {
  it("treats a risk of exactly 0 as set, not missing", () => {
    const result = run(
      [rule({ subject_key: "risk_percent", operator: "is_set" })],
      trade({ risk_percent: 0 }),
    );
    expect(result.evaluations[0].outcome).toBe("pass");
  });

  it("compares a zero value rather than skipping it", () => {
    const result = run(
      [rule({ subject_key: "risk_percent", operator: "lte", number_value: 1 })],
      trade({ risk_percent: 0 }),
    );
    expect(result.evaluations[0].outcome).toBe("pass");
    expect(result.evaluations[0].actual).toBe("0");
  });

  it("treats a false checkbox as set", () => {
    const result = run(
      [rule({ subject_source: "custom", subject_key: "checked", operator: "is_set" })],
      trade({ custom_fields: { checked: false } }),
    );
    expect(result.evaluations[0].outcome).toBe("pass");
  });
});

describe("evaluateStrategyRules — presence rules", () => {
  it("passes is_set when a stop was recorded and fails when it wasn't", () => {
    expect(run([rule({ subject_key: "stop_loss", operator: "is_set" })]).evaluations[0].outcome).toBe(
      "pass",
    );
    expect(
      run([rule({ subject_key: "stop_loss", operator: "is_set" })], trade({ stop_loss: null }))
        .evaluations[0].outcome,
    ).toBe("fail");
  });

  it("treats a blank string as not set", () => {
    const result = run(
      [rule({ subject_source: "custom", subject_key: "note", operator: "is_set" })],
      trade({ custom_fields: { note: "   " } }),
    );
    expect(result.evaluations[0].outcome).toBe("fail");
  });

  it("treats an empty tag list as not set", () => {
    const result = run(
      [rule({ subject_source: "custom", subject_key: "tags", operator: "is_set" })],
      trade({ custom_fields: { tags: [] } }),
    );
    expect(result.evaluations[0].outcome).toBe("fail");
  });
});

describe("evaluateStrategyRules — custom fields", () => {
  it("reads a global custom field", () => {
    const result = run(
      [
        rule({
          subject_source: "custom",
          subject_key: "conviction",
          operator: "gte",
          number_value: 4,
        }),
      ],
      trade({ custom_fields: { conviction: 5 } }),
    );
    expect(result.evaluations[0].outcome).toBe("pass");
  });

  it("coerces a numeric string, which is how jsonb often holds it", () => {
    const result = run(
      [
        rule({
          subject_source: "custom",
          subject_key: "conviction",
          operator: "gte",
          number_value: 4,
        }),
      ],
      trade({ custom_fields: { conviction: "5" } }),
    );
    expect(result.evaluations[0].outcome).toBe("pass");
  });

  it("prefers a strategy-scoped value over a global one of the same key", () => {
    const result = run(
      [
        rule({
          subject_source: "custom",
          subject_key: "grade",
          operator: "text_eq",
          text_value: "A",
        }),
      ],
      trade({
        custom_fields: { grade: "C" },
        strategy_field_values: { [STRATEGY_ID]: { grade: "A" } },
      }),
    );
    expect(result.evaluations[0].outcome).toBe("pass");
  });

  it("matches a tag list by membership, case-insensitively", () => {
    const result = run(
      [
        rule({
          subject_source: "custom",
          subject_key: "emotion_before",
          operator: "contains",
          text_value: "CALM",
        }),
      ],
      trade({ custom_fields: { emotion_before: ["calm", "focused"] } }),
    );
    expect(result.evaluations[0].outcome).toBe("pass");
  });

  it("does not let a custom field shadow a column of the same name", () => {
    // subject_source is what decides where the value comes from -- a custom
    // field called risk_percent must never be read as the column.
    const result = run(
      [rule({ subject_source: "core", subject_key: "risk_percent", operator: "lte", number_value: 1 })],
      trade({ risk_percent: 5, custom_fields: { risk_percent: 0.1 } }),
    );
    expect(result.evaluations[0].outcome).toBe("fail");
  });
});

describe("evaluateStrategyRules — derived subjects", () => {
  it("passes 'stop was not moved' when history shows no movement", () => {
    const result = run([
      rule({ subject_source: "derived", subject_key: "stop_moved", operator: "is_false" }),
    ]);
    expect(result.evaluations[0].outcome).toBe("pass");
    expect(result.evaluations[0].caveat).toBeUndefined();
  });

  it("fails it when the stop was moved", () => {
    const result = run(
      [rule({ subject_source: "derived", subject_key: "stop_moved", operator: "is_false" })],
      trade(),
      { ...noAdjustments, stopMoved: true },
    );
    expect(result.evaluations[0].outcome).toBe("fail");
  });

  it("caveats a negative when history may have been pruned", () => {
    // Migration 0023 caps history at 50 snapshots per trade, so "not moved"
    // is only ever "not moved in what we still have".
    const result = run(
      [rule({ subject_source: "derived", subject_key: "stop_moved", operator: "is_false" })],
      trade(),
      { ...noAdjustments, mayBeTruncated: true },
    );
    expect(result.evaluations[0].outcome).toBe("pass");
    expect(result.evaluations[0].caveat).toContain("retained edit history");
  });

  it("does not caveat a positive — a change we saw is a change that happened", () => {
    const result = run(
      [rule({ subject_source: "derived", subject_key: "stop_moved", operator: "is_true" })],
      trade(),
      { ...noAdjustments, stopMoved: true, mayBeTruncated: true },
    );
    expect(result.evaluations[0].outcome).toBe("pass");
    expect(result.evaluations[0].caveat).toBeUndefined();
  });

  it("is unevaluable rather than passing when history wasn't loaded", () => {
    const result = evaluateStrategyRules(
      {
        trade: trade(),
        strategyId: STRATEGY_ID,
        rules: [rule({ subject_source: "derived", subject_key: "stop_moved", operator: "is_false" })],
        adjustments: null,
      },
      "Breakout",
    );
    expect(result.evaluations[0].outcome).toBe("unevaluable");
  });

  it("is unevaluable when a holding-period rule has no exit date", () => {
    const result = run(
      [
        rule({
          subject_source: "derived",
          subject_key: "holding_days",
          operator: "lte",
          number_value: 7,
        }),
      ],
      trade({ exit_date: null }),
    );
    expect(result.evaluations[0].outcome).toBe("unevaluable");
  });
});

describe("evaluateStrategyRules — malformed rules degrade safely", () => {
  it("is unevaluable when the rule points at a field that no longer exists", () => {
    const result = run([rule({ subject_key: "nonexistent_column" })]);
    expect(result.evaluations[0].outcome).toBe("unevaluable");
    expect(result.evaluations[0].reason).toContain("no longer exists");
  });

  it("is unevaluable when a comparison has no value", () => {
    const result = run([rule({ operator: "lte", number_value: null })]);
    expect(result.evaluations[0].outcome).toBe("unevaluable");
  });

  it("is unevaluable when a text rule has no value to compare", () => {
    const result = run([
      rule({ subject_key: "direction", operator: "text_eq", text_value: "  " }),
    ]);
    expect(result.evaluations[0].outcome).toBe("unevaluable");
  });

  it("is unevaluable when a number rule meets text", () => {
    const result = run(
      [rule({ subject_key: "ticker", operator: "lte", number_value: 1 })],
      trade({ ticker: "NVDA" }),
    );
    expect(result.evaluations[0].outcome).toBe("unevaluable");
  });
});

describe("evaluateStrategyRules — text operators", () => {
  it("matches direction case-insensitively", () => {
    const result = run([
      rule({ subject_key: "direction", operator: "text_eq", text_value: "LONG" }),
    ]);
    expect(result.evaluations[0].outcome).toBe("pass");
  });

  it("fails text_neq when the value matches", () => {
    const result = run([
      rule({ subject_key: "direction", operator: "text_neq", text_value: "long" }),
    ]);
    expect(result.evaluations[0].outcome).toBe("fail");
  });

  it("does a substring match on plain text", () => {
    const result = run(
      [
        rule({
          subject_source: "custom",
          subject_key: "notes",
          operator: "contains",
          text_value: "volume",
        }),
      ],
      trade({ custom_fields: { notes: "Broke out on heavy VOLUME above the range" } }),
    );
    expect(result.evaluations[0].outcome).toBe("pass");
  });
});
