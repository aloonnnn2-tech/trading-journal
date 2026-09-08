import { describe, expect, it } from "vitest";
import type { Trade } from "@/lib/trades/types";
import { evaluateGoal, resolveGoalPeriod, type Goal, type GoalTrade } from "./evaluate";

// Two properties carry this feature. First, an "at most" goal must fill up as
// the trader SUCCEEDS, not as they break it -- the obvious implementation gets
// this exactly backwards. Second, a goal must never punish a trade for a field
// that was never filled in; that reuses the plan-rule evaluator's rule that an
// unrecorded value is unevaluable rather than failed.

const NY = "America/New_York";
const NOW = new Date("2026-08-15T12:00:00Z");

function goal(over: Partial<Goal> = {}): Goal {
  return {
    id: "g1",
    label: "A goal",
    kind: "aggregate",
    subject_source: null,
    subject_key: null,
    operator: null,
    number_value: null,
    number_value_max: null,
    text_value: null,
    metric: "trade_count",
    mistake_label: null,
    target: 20,
    target_direction: "at_least",
    period: "month",
    active: true,
    sort_order: 0,
    ...over,
  };
}

type TradeOverride = Omit<Partial<GoalTrade>, "trade"> & { trade?: Partial<Trade> };

function t(over: TradeOverride = {}): GoalTrade {
  // `trade` is pulled out before the spread: leaving it in would overwrite the
  // assembled full row with the partial override.
  const { trade: tradeOverride, ...rest } = over;

  const trade = {
    id: "t1",
    risk_percent: 0.8,
    dollar_pl: 100,
    r_multiple: 1,
    custom_fields: {},
    strategy_field_values: {},
    ...tradeOverride,
  } as Trade;

  return {
    id: trade.id,
    exit_date: "2026-08-10T19:00:00Z",
    dollar_pl: trade.dollar_pl ?? null,
    r_multiple: trade.r_multiple ?? null,
    mistakes: [],
    trade,
    ...rest,
  };
}

/** n trades inside the current month. */
function many(n: number, over: TradeOverride = {}) {
  return Array.from({ length: n }, () => t(over));
}

describe("resolveGoalPeriod", () => {
  it("uses the trader's calendar month, not a rolling window", () => {
    // A rolling 30 days would drop trades out the back as the month went on,
    // so progress would fall without the trader doing anything.
    const { startIso, label } = resolveGoalPeriod("month", NY, NOW);
    expect(label).toBe("August 2026");
    expect(startIso).toBe("2026-08-01T04:00:00.000Z");
  });

  it("resolves the quarter and the year", () => {
    expect(resolveGoalPeriod("quarter", NY, NOW).label).toBe("Q3 2026");
    expect(resolveGoalPeriod("year", NY, NOW).label).toBe("2026");
  });

  it("has no start for all time", () => {
    expect(resolveGoalPeriod("all_time", NY, NOW).startIso).toBeNull();
  });

  it("uses the trader's timezone for the boundary", () => {
    // Midnight on the 1st in New York is 4am UTC; using UTC would put the
    // evening of the 31st into the wrong month.
    expect(resolveGoalPeriod("month", "UTC", NOW).startIso).toBe("2026-08-01T00:00:00.000Z");
  });
});

describe("evaluateGoal — aggregate", () => {
  it("counts trades against an at-least target", () => {
    const progress = evaluateGoal(goal({ target: 20 }), many(12), NY, NOW);
    expect(progress.current).toBe(12);
    expect(progress.met).toBe(false);
    expect(progress.fraction).toBeCloseTo(0.6);
  });

  it("marks an at-least goal met once reached", () => {
    const progress = evaluateGoal(goal({ target: 10 }), many(12), NY, NOW);
    expect(progress.met).toBe(true);
    // Capped: a bar past full says nothing the figure beside it doesn't.
    expect(progress.fraction).toBe(1);
  });

  it("measures average loss in R over losing trades only", () => {
    const trades = [
      ...many(3, { trade: { dollar_pl: -100, r_multiple: -1.2 } }),
      ...many(5, { trade: { dollar_pl: 100, r_multiple: 2 } }),
    ];
    const progress = evaluateGoal(
      goal({ metric: "avg_loss_r", target: -1, target_direction: "at_most" }),
      trades,
      NY,
      NOW,
    );

    expect(progress.current).toBeCloseTo(-1.2);
    expect(progress.sample).toBe(3);
    // -1.2 is "at most" -1, so the goal is met.
    expect(progress.met).toBe(true);
  });

  it("reports win rate as a percentage", () => {
    const trades = [
      ...many(3, { trade: { dollar_pl: 100 } }),
      ...many(1, { trade: { dollar_pl: -100 } }),
    ];
    const progress = evaluateGoal(goal({ metric: "win_rate", target: 60 }), trades, NY, NOW);
    expect(progress.current).toBeCloseTo(75);
    expect(progress.met).toBe(true);
  });

  it("says so when the period has no trades rather than showing zero progress", () => {
    const progress = evaluateGoal(goal(), [], NY, NOW);
    expect(progress.current).toBeNull();
    expect(progress.met).toBeNull();
    expect(progress.reason).toContain("No closed trades");
  });

  it("ignores trades outside the period", () => {
    const trades = [
      ...many(5),
      ...many(4, { exit_date: "2026-07-10T19:00:00Z" }), // previous month
    ];
    expect(evaluateGoal(goal(), trades, NY, NOW).current).toBe(5);
  });
});

describe("evaluateGoal — at-most goals fill up as you succeed", () => {
  it("is complete at zero against a ceiling", () => {
    // The trap: the obvious implementation fills the bar as the trader BREAKS
    // the goal. Zero moved stops against a ceiling of three is 100% done.
    const progress = evaluateGoal(
      goal({ kind: "reduction", mistake_label: "Moved stop", target: 3, target_direction: "at_most" }),
      many(10),
      NY,
      NOW,
    );

    expect(progress.current).toBe(0);
    expect(progress.met).toBe(true);
    expect(progress.fraction).toBe(1);
  });

  it("still counts as met at exactly the ceiling", () => {
    const trades = [...many(3, { mistakes: ["Moved stop"] }), ...many(7)];
    const progress = evaluateGoal(
      goal({ kind: "reduction", mistake_label: "Moved stop", target: 3, target_direction: "at_most" }),
      trades,
      NY,
      NOW,
    );
    expect(progress.current).toBe(3);
    expect(progress.met).toBe(true);
  });

  it("falls back, not forward, once the ceiling is breached", () => {
    const trades = [...many(6, { mistakes: ["Moved stop"] }), ...many(4)];
    const progress = evaluateGoal(
      goal({ kind: "reduction", mistake_label: "Moved stop", target: 3, target_direction: "at_most" }),
      trades,
      NY,
      NOW,
    );

    expect(progress.current).toBe(6);
    expect(progress.met).toBe(false);
    expect(progress.fraction!).toBeLessThan(1);
    // Never negative, however badly it went.
    expect(progress.fraction!).toBeGreaterThanOrEqual(0);
  });

  it("counts only the named mistake", () => {
    const trades = [
      ...many(2, { mistakes: ["Moved stop"] }),
      ...many(5, { mistakes: ["Oversized position"] }),
    ];
    const progress = evaluateGoal(
      goal({ kind: "reduction", mistake_label: "Moved stop", target: 0, target_direction: "at_most" }),
      trades,
      NY,
      NOW,
    );
    expect(progress.current).toBe(2);
  });
});

describe("evaluateGoal — adherence", () => {
  const riskGoal = goal({
    kind: "adherence",
    subject_source: "core",
    subject_key: "risk_percent",
    operator: "lte",
    number_value: 1,
    metric: null,
    target: 90,
    target_direction: "at_least",
  });

  it("reports the percentage of trades meeting the condition", () => {
    const trades = [
      ...many(9, { trade: { risk_percent: 0.8 } }),
      ...many(1, { trade: { risk_percent: 2 } }),
    ];
    const progress = evaluateGoal(riskGoal, trades, NY, NOW);

    expect(progress.current).toBeCloseTo(90);
    expect(progress.met).toBe(true);
    expect(progress.sample).toBe(10);
  });

  it("excludes trades that never recorded the value, rather than failing them", () => {
    // The plan-rule engine's rule, inherited here: an unrecorded field is
    // unevaluable, not a violation. Counting it as a failure would punish
    // incomplete logging as if it were indiscipline.
    const trades = [
      ...many(4, { trade: { risk_percent: 0.8 } }),
      ...many(6, { trade: { risk_percent: null } }),
    ];
    const progress = evaluateGoal(riskGoal, trades, NY, NOW);

    expect(progress.current).toBeCloseTo(100);
    // The denominator is the four checkable trades, not all ten.
    expect(progress.sample).toBe(4);
  });

  it("says so when no trade in the period carried the value", () => {
    const trades = many(5, { trade: { risk_percent: null } });
    const progress = evaluateGoal(riskGoal, trades, NY, NOW);

    expect(progress.current).toBeNull();
    expect(progress.reason).toContain("recorded the value");
  });

  it("reads a custom field the trader defined", () => {
    // This is what makes "take only A setups" measurable the moment a grading
    // field exists -- and unmeasurable, honestly, until then.
    const gradeGoal = goal({
      kind: "adherence",
      subject_source: "custom",
      subject_key: "setup_grade",
      operator: "text_eq",
      text_value: "A",
      metric: null,
      target: 80,
    });
    const trades = [
      ...many(8, { trade: { custom_fields: { setup_grade: "A" } } }),
      ...many(2, { trade: { custom_fields: { setup_grade: "B" } } }),
    ];

    expect(evaluateGoal(gradeGoal, trades, NY, NOW).current).toBeCloseTo(80);
  });
});
