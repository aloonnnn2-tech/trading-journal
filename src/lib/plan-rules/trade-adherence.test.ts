import { describe, expect, it } from "vitest";
import type { Trade } from "@/lib/trades/types";
import type { TradeHistoryEntry } from "@/lib/trades/history";
import { planAdherenceFor } from "./trade-adherence";
import type { StrategyRule } from "./types";

// The helper the trade page and the trade side panel share. What matters is
// that it hands the rules engine the same inputs the trade page used to build
// inline: history turned oldest-first into adjustments, one result per tagged
// strategy that has an enabled rule, and the strategy's own name.

function trade(over: Partial<Trade> = {}): Trade {
  return {
    id: "t1",
    user_id: "u1",
    mode: "trade",
    ticker: "NVDA",
    direction: "long",
    status: "closed",
    result: "win",
    entry_price: 100,
    exit_price: 110,
    stop_loss: 95,
    take_profit: 115,
    risk_percent: 0.8,
    entry_date: "2026-08-10T13:30:00Z",
    exit_date: "2026-08-14T19:00:00Z",
    custom_fields: {},
    strategy_field_values: {},
    ...over,
  } as Trade;
}

function rule(strategy_id: string, over: Partial<StrategyRule> = {}): StrategyRule {
  return {
    id: `r-${Math.random()}`,
    strategy_id,
    label: "Risk under 1%",
    subject_source: "core",
    subject_key: "risk_percent",
    operator: "lte",
    number_value: 1,
    number_value_max: null,
    text_value: null,
    enabled: true,
    sort_order: 0,
    ...over,
  } as StrategyRule;
}

const stopMovedRule = (strategy_id: string) =>
  rule(strategy_id, { label: "Never move the stop", subject_source: "derived", subject_key: "stop_moved", operator: "is_false", number_value: null });

/** Newest-first, as listTradeHistory returns it. */
function history(stops: number[]): TradeHistoryEntry[] {
  return stops
    .map((stop_loss, i) => ({ id: `h${i}`, createdAt: `2026-08-1${i}T00:00:00Z`, snapshot: { stop_loss } as Trade }))
    .reverse();
}

const strategies = [
  { id: "s1", name: "Earnings Gap Fade" },
  { id: "s2", name: "Breakout" },
];

describe("planAdherenceFor", () => {
  it("scores each tagged strategy that has an enabled rule, by name", () => {
    const { adherences } = planAdherenceFor({
      trade: trade(),
      strategyIds: ["s1", "s2"],
      strategies,
      rulesByStrategy: { s1: [rule("s1")], s2: [rule("s2", { enabled: false })] },
      history: [],
    });
    expect(adherences.map((a) => a.strategyName)).toEqual(["Earnings Gap Fade"]);
    expect(adherences[0].passed).toBe(1);
  });

  it("returns nothing for a trade with no strategies", () => {
    const { adherences } = planAdherenceFor({ trade: trade(), strategyIds: [], strategies, rulesByStrategy: {}, history: [] });
    expect(adherences).toEqual([]);
  });

  it("reads a moved stop from the history, oldest first", () => {
    // The stop went 90 -> 95 over two edits; the trade now has 95.
    const { adjustments, adherences } = planAdherenceFor({
      trade: trade({ stop_loss: 95 }),
      strategyIds: ["s1"],
      strategies,
      rulesByStrategy: { s1: [stopMovedRule("s1")] },
      history: history([90, 95]),
    });
    expect(adjustments.stopMoved).toBe(true);
    expect(adherences[0].evaluations[0].outcome).toBe("fail");
  });

  it("passes the stop rule when the history shows no move", () => {
    const { adherences } = planAdherenceFor({
      trade: trade({ stop_loss: 95 }),
      strategyIds: ["s1"],
      strategies,
      rulesByStrategy: { s1: [stopMovedRule("s1")] },
      history: history([95, 95]),
    });
    expect(adherences[0].evaluations[0].outcome).toBe("pass");
  });
});
