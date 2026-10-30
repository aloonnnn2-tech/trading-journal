import type { MovingAverageType } from "@/lib/indicators/moving-average";
import type { RuleOperator, SubjectSource } from "@/lib/plan-rules/types";

// Overall rules (0081): one list every trade is checked against. See the
// migration for the four kinds. Field rules reuse the strategy-rule
// vocabulary and evaluator; moving-average rules are checked against real
// daily prices (market-checks.ts); text rules are judged only by the AI.

export const RULE_KINDS = ["field", "ma_exit", "ma_entry", "text"] as const;
export type OverallRuleKind = (typeof RULE_KINDS)[number];

export const ENTRY_TEMPLATES = ["price_above_ma", "ma_above_ma"] as const;
export type EntryTemplate = (typeof ENTRY_TEMPLATES)[number];

export const RULE_DIRECTIONS = ["both", "long", "short"] as const;
export type RuleDirection = (typeof RULE_DIRECTIONS)[number];

/** A rule as stored in `overall_rules`. */
export interface OverallRule {
  id: string;
  label: string;
  kind: OverallRuleKind;
  subject_source: SubjectSource | null;
  subject_key: string | null;
  operator: RuleOperator | null;
  number_value: number | null;
  number_value_max: number | null;
  text_value: string | null;
  ma_type: MovingAverageType | null;
  ma_period: number | null;
  ma_type_2: MovingAverageType | null;
  ma_period_2: number | null;
  entry_template: EntryTemplate | null;
  grace_days: number;
  direction: RuleDirection;
  enabled: boolean;
  sort_order: number;
  updated_at: string;
}

/**
 * followed / broken: the rule applied and was kept or not.
 * not_triggered: an exit rule whose condition never happened while the
 *   trade was open -- nothing to keep, so it counts neither way.
 * unevaluable: there was nothing to check it with (no price data, too little
 *   history, a value never recorded). Never a failure.
 * ai: a text rule -- only the AI review judges it.
 */
export type CheckOutcome = "followed" | "broken" | "not_triggered" | "unevaluable" | "ai";

/** What a moving-average check found, kept for the trade card and the AI. */
export interface CheckDetail {
  /** One sentence for the user, e.g. "Closed below SMA 150 on Oct 3...". */
  summary: string;
  /** Exit rules: the first close past the average. */
  trigger_date?: string;
  trigger_close?: number;
  trigger_ma?: number;
  /** Exit rules: the last day the trade should have been out by. */
  deadline_date?: string;
  deadline_close?: number;
  /** Exit rules: trading days held past the deadline. */
  days_late?: number;
  /**
   * Exit rules, broken: what selling at the deadline's close would have
   * made on the shares still held, minus what they actually made. Positive
   * = breaking the rule cost money. Gross of fees.
   */
  cost?: number;
  /** Entry rules: the averages on the day before entry. */
  entry_price?: number;
  ma_value?: number;
  ma_value_2?: number;
  /** Set when the trade is still open. */
  still_open?: boolean;
}

export interface RuleCheck {
  rule: OverallRule;
  outcome: CheckOutcome;
  detail: CheckDetail;
}
