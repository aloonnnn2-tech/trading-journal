import type { RuleOperator, SubjectValueType } from "./types";

// The catalogue of things a rule may test.
//
// Deliberately a fixed, curated list rather than "every column on `trades`".
// Two reasons: a rule over `created_at` or `user_id` is meaningless, and every
// entry here has to be something the user recognises from the trade form. The
// labels below are the ones the trade card uses, so a rule reads the same way
// as the field it tests.
//
// Custom fields are NOT listed here -- they are per-user, so they are resolved
// at runtime from field_definitions and appended to this catalogue by the UI.

export interface SubjectDefinition {
  key: string;
  label: string;
  type: SubjectValueType;
  /** Rendering hint only; never used in comparisons. */
  unit?: "$" | "%" | "R" | "days";
  /** Shown under the option in the rule editor when the meaning isn't obvious. */
  hint?: string;
}

/**
 * Columns on `trades`.
 *
 * `dollar_pl` and `percent_return` are included even though a rule about the
 * OUTCOME is a strange plan rule -- a trader may legitimately want "never let
 * a loss exceed $200", which is a risk rule expressed on the result.
 */
export const CORE_SUBJECTS: SubjectDefinition[] = [
  { key: "risk_percent", label: "Risk % of account", type: "number", unit: "%" },
  { key: "risk_amount", label: "Risk amount", type: "number", unit: "$" },
  { key: "risk_reward_ratio", label: "Planned R:R", type: "number" },
  { key: "r_multiple", label: "R multiple realised", type: "number", unit: "R" },
  { key: "position_size", label: "Position size", type: "number", unit: "$" },
  { key: "dollar_amount", label: "Amount invested", type: "number", unit: "$" },
  { key: "shares", label: "Quantity", type: "number" },
  { key: "entry_price", label: "Entry price", type: "number", unit: "$" },
  { key: "exit_price", label: "Exit price", type: "number", unit: "$" },
  { key: "stop_loss", label: "Stop loss", type: "number", unit: "$" },
  { key: "take_profit", label: "Take profit", type: "number", unit: "$" },
  { key: "commission", label: "Commission", type: "number", unit: "$" },
  { key: "dollar_pl", label: "P&L (net)", type: "number", unit: "$" },
  { key: "percent_return", label: "Return %", type: "number", unit: "%" },
  { key: "ticker", label: "Ticker", type: "text" },
  { key: "direction", label: "Direction", type: "text", hint: "long or short" },
  { key: "asset_type", label: "Asset type", type: "text" },
  { key: "market", label: "Market", type: "text" },
];

/**
 * Values computed from other stored data rather than read from a column.
 *
 * `stop_moved` / `target_moved` come from the edit-history snapshots, which is
 * the only place they are visible at all -- see src/lib/trades/adjustments.ts,
 * including why a negative answer carries a caveat.
 */
export const DERIVED_SUBJECTS: SubjectDefinition[] = [
  {
    key: "holding_days",
    label: "Holding period",
    type: "number",
    unit: "days",
    hint: "Entry to exit. Needs both dates.",
  },
  {
    key: "stop_moved",
    label: "Stop was moved",
    type: "boolean",
    hint: "From the trade's edit history.",
  },
  {
    key: "target_moved",
    label: "Target was moved",
    type: "boolean",
    hint: "From the trade's edit history.",
  },
];

/**
 * Which operators make sense for each value type.
 *
 * `is_set` / `is_not_set` are offered everywhere because "I must record a
 * stop before entering" is one of the most common real plan rules, and it is a
 * presence check rather than a comparison.
 */
export const OPERATORS_BY_TYPE: Record<SubjectValueType, RuleOperator[]> = {
  number: ["lte", "lt", "gte", "gt", "eq", "neq", "between", "is_set", "is_not_set"],
  boolean: ["is_true", "is_false", "is_set", "is_not_set"],
  text: ["text_eq", "text_neq", "contains", "is_set", "is_not_set"],
  text_list: ["contains", "is_set", "is_not_set"],
};

export const OPERATOR_LABELS: Record<RuleOperator, string> = {
  lte: "is at most",
  lt: "is less than",
  gte: "is at least",
  gt: "is greater than",
  eq: "equals",
  neq: "does not equal",
  between: "is between",
  is_set: "is recorded",
  is_not_set: "is not recorded",
  is_true: "is yes",
  is_false: "is no",
  text_eq: "is",
  text_neq: "is not",
  contains: "contains",
};

/** Operators that need `number_value`. `between` additionally needs a max. */
export const NUMERIC_OPERATORS: ReadonlySet<RuleOperator> = new Set([
  "lte",
  "lt",
  "gte",
  "gt",
  "eq",
  "neq",
  "between",
]);

/** Operators that need `text_value`. */
export const TEXT_OPERATORS: ReadonlySet<RuleOperator> = new Set([
  "text_eq",
  "text_neq",
  "contains",
]);

/**
 * Maps a user's custom field type onto the value type a rule sees.
 *
 * `date` deliberately has no mapping: comparing a date against a constant is
 * almost never the rule a trader means ("entered before 10am" is a time-of-day
 * question this app doesn't model), and offering a broken-feeling option is
 * worse than not offering it. `color_picker` is excluded for the same reason.
 */
export const FIELD_TYPE_TO_SUBJECT_TYPE: Record<string, SubjectValueType | undefined> = {
  number: "number",
  currency: "number",
  percentage: "number",
  rating: "number",
  checkbox: "boolean",
  text: "text",
  large_notes: "text",
  dropdown: "text",
  tag: "text_list",
  multi_select: "text_list",
};

export function findCoreSubject(key: string): SubjectDefinition | undefined {
  return CORE_SUBJECTS.find((s) => s.key === key);
}

export function findDerivedSubject(key: string): SubjectDefinition | undefined {
  return DERIVED_SUBJECTS.find((s) => s.key === key);
}
