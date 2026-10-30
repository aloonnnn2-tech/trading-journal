import { evaluateStrategyRules } from "@/lib/plan-rules/evaluate";
import type { StrategyRule } from "@/lib/plan-rules/types";
import type { TradeAdjustments } from "@/lib/trades/adjustments";
import type { Trade } from "@/lib/trades/types";
import type { CheckDetail, CheckOutcome, OverallRule, RuleCheck } from "./types";

// One trade against the overall rules, from data already loaded. Pure.
//
// - field rules: the strategy-rule evaluator, unchanged (pass -> followed,
//   fail -> broken), so the two can never judge the same value differently;
// - moving-average rules: the stored result (trade_rule_checks) when it is
//   still fresh, else "not checked yet" until queries.ts works it out;
// - text rules: "ai" -- only the AI review judges them.

/** A row of trade_rule_checks. */
export interface StoredCheck {
  trade_id: string;
  rule_id: string;
  outcome: Exclude<CheckOutcome, "ai">;
  detail: CheckDetail;
  trade_updated_at: string;
  rule_updated_at: string;
  computed_at: string;
}

export const MARKET_KINDS = new Set<OverallRule["kind"]>(["ma_exit", "ma_entry"]);

/** An open trade's result moves with every new close: recheck after this. */
const OPEN_TRADE_FRESH_MS = 6 * 3600_000;

/** Whether the rule is part of this trade's plan at all. */
export function ruleApplies(rule: OverallRule, trade: Pick<Trade, "mode" | "direction" | "status">): boolean {
  if (!rule.enabled) return false;
  if (trade.mode === "investment") return false;
  if (trade.status !== "open" && trade.status !== "closed") return false;
  if (rule.direction !== "both" && trade.direction != null && trade.direction !== rule.direction) return false;
  return true;
}

/** Whether a stored moving-average result still describes the trade and rule. */
export function isFresh(
  stored: StoredCheck,
  trade: Pick<Trade, "updated_at" | "status">,
  rule: Pick<OverallRule, "updated_at">,
  now = Date.now(),
): boolean {
  if (Date.parse(stored.trade_updated_at) !== Date.parse(trade.updated_at)) return false;
  if (Date.parse(stored.rule_updated_at) !== Date.parse(rule.updated_at)) return false;
  if (trade.status === "open" && now - Date.parse(stored.computed_at) > OPEN_TRADE_FRESH_MS) return false;
  return true;
}

/** The moving-average rules this trade needs (re)checked. */
export function staleMarketRules(
  trade: Pick<Trade, "id" | "mode" | "direction" | "status" | "updated_at">,
  rules: OverallRule[],
  stored: StoredCheck[],
  now = Date.now(),
): OverallRule[] {
  return rules.filter((rule) => {
    if (!MARKET_KINDS.has(rule.kind) || !ruleApplies(rule, trade)) return false;
    const hit = stored.find((s) => s.trade_id === trade.id && s.rule_id === rule.id);
    return !hit || !isFresh(hit, trade, rule, now);
  });
}

export function asStrategyRule(rule: OverallRule): StrategyRule {
  return {
    id: rule.id,
    strategy_id: "",
    label: rule.label,
    subject_source: rule.subject_source ?? "core",
    subject_key: rule.subject_key ?? "",
    operator: rule.operator ?? "is_set",
    number_value: rule.number_value,
    number_value_max: rule.number_value_max,
    text_value: rule.text_value,
    enabled: true,
    sort_order: rule.sort_order,
  };
}

export interface EvaluateInput {
  trade: Trade;
  rules: OverallRule[];
  /** For "stop moved" style field rules; null makes them unevaluable. */
  adjustments: TradeAdjustments | null;
  stored: StoredCheck[];
  now?: number;
}

export function evaluateOverallRules(input: EvaluateInput): RuleCheck[] {
  const { trade, rules, adjustments, stored } = input;
  const now = input.now ?? Date.now();
  const applicable = rules.filter((rule) => ruleApplies(rule, trade));

  const fieldRules = applicable.filter((r) => r.kind === "field");
  const fieldResults = new Map<string, RuleCheck>();
  if (fieldRules.length > 0) {
    const adherence = evaluateStrategyRules(
      { trade, strategyId: "", rules: fieldRules.map(asStrategyRule), adjustments },
      "Overall rules",
    );
    for (const evaluation of adherence.evaluations) {
      const rule = fieldRules.find((r) => r.id === evaluation.rule.id)!;
      const outcome: CheckOutcome =
        evaluation.outcome === "pass" ? "followed" : evaluation.outcome === "fail" ? "broken" : "unevaluable";
      const summary =
        evaluation.outcome === "unevaluable"
          ? (evaluation.reason ?? "Nothing to check this with.")
          : `Was ${evaluation.actual ?? "—"}.${evaluation.caveat ? ` ${evaluation.caveat}` : ""}`;
      fieldResults.set(rule.id, { rule, outcome, detail: { summary } });
    }
  }

  return applicable.map((rule): RuleCheck => {
    if (rule.kind === "field") {
      return fieldResults.get(rule.id) ?? { rule, outcome: "unevaluable", detail: { summary: "Nothing to check this with." } };
    }
    if (rule.kind === "text") {
      return { rule, outcome: "ai", detail: { summary: "Judged in the AI review." } };
    }
    const hit = stored.find((s) => s.trade_id === trade.id && s.rule_id === rule.id);
    if (hit && isFresh(hit, trade, rule, now)) return { rule, outcome: hit.outcome, detail: hit.detail };
    return { rule, outcome: "unevaluable", detail: { summary: "Not checked against prices yet." } };
  });
}

/** Counts for one trade: what the trade card's header line says. */
export function tally(checks: RuleCheck[]) {
  const followed = checks.filter((c) => c.outcome === "followed").length;
  const broken = checks.filter((c) => c.outcome === "broken").length;
  return {
    followed,
    broken,
    notTriggered: checks.filter((c) => c.outcome === "not_triggered").length,
    unevaluable: checks.filter((c) => c.outcome === "unevaluable").length,
    ai: checks.filter((c) => c.outcome === "ai").length,
    score: followed + broken === 0 ? null : followed / (followed + broken),
  };
}
