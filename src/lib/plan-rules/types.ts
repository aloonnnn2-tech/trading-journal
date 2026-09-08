/** Must stay in sync with 0033's `check (subject_source in (...))`. */
export const SUBJECT_SOURCES = ["core", "derived", "custom"] as const;
export type SubjectSource = (typeof SUBJECT_SOURCES)[number];

/** Must stay in sync with 0033's `check (operator in (...))`. */
export const OPERATORS = [
  "lte",
  "lt",
  "gte",
  "gt",
  "eq",
  "neq",
  "between",
  "is_set",
  "is_not_set",
  "is_true",
  "is_false",
  "text_eq",
  "text_neq",
  "contains",
] as const;
export type RuleOperator = (typeof OPERATORS)[number];

/**
 * What kind of value a subject yields, which decides the operators offered
 * for it. `text_list` covers the tag and multi-select field types, whose
 * values are arrays -- "contains" means membership there and substring match
 * on a plain string, which is what a user means by it in both cases.
 */
export type SubjectValueType = "number" | "boolean" | "text" | "text_list";

/** A rule as stored in `strategy_rules` (0033). */
export interface StrategyRule {
  id: string;
  strategy_id: string;
  label: string;
  subject_source: SubjectSource;
  subject_key: string;
  operator: RuleOperator;
  number_value: number | null;
  number_value_max: number | null;
  text_value: string | null;
  enabled: boolean;
  sort_order: number;
}

/**
 * The three outcomes a rule can have, and the distinction that matters most
 * in this whole feature:
 *
 * `unevaluable` is NOT a failure. A rule testing risk % against a trade where
 * risk was never recorded has not been broken -- there is simply nothing to
 * check. Counting that as a violation would punish incomplete logging as if
 * it were indiscipline, and would make the adherence score say something
 * false. Unevaluable rules are excluded from the score's denominator and
 * reported separately.
 */
export type RuleOutcome = "pass" | "fail" | "unevaluable";

export interface RuleEvaluation {
  rule: StrategyRule;
  outcome: RuleOutcome;
  /** The value that was tested, formatted for display. Null if unevaluable. */
  actual: string | null;
  /** Why it couldn't be evaluated -- shown to the user so a blank result is
   *  never mysterious. Null unless the outcome is `unevaluable`. */
  reason: string | null;
  /** Set when the answer rests on possibly-pruned edit history, so the UI can
   *  say "none in retained history" rather than asserting a negative. */
  caveat?: string;
}

export interface StrategyAdherence {
  strategyId: string;
  strategyName: string;
  evaluations: RuleEvaluation[];
  passed: number;
  failed: number;
  unevaluable: number;
  /**
   * passed / (passed + failed). Null when nothing could be evaluated -- which
   * renders as "—", not as 0%. A trade with no checkable rules has no score,
   * and showing 0% would read as total failure.
   */
  score: number | null;
}
