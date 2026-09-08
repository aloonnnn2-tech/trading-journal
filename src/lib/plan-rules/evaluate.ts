import type { Trade } from "@/lib/trades/types";
import type { TradeAdjustments } from "@/lib/trades/adjustments";
import { holdingDays } from "@/lib/trades/behaviour";
import { findCoreSubject } from "./subjects";
import type { RuleEvaluation, RuleOutcome, StrategyAdherence, StrategyRule } from "./types";

// Evaluating a trade against the rules of the strategies it was tagged with.
//
// **A pure function over data already loaded.** No queries, no fetches, no
// clock. That is what lets the result be recomputed on every render instead of
// stored -- and stored results would be a second source of truth that goes
// stale the moment the trade is edited.
//
// The rule that shapes everything here: **a value that isn't there is not a
// violation.** A rule testing risk % against a trade where risk was never
// recorded is unevaluable, not failed. Counting it as failed would punish
// incomplete logging as if it were indiscipline, and would put a number on
// screen that means something other than what it says.

/** Everything the evaluator needs, passed in so it stays pure. */
export interface EvaluationInput {
  trade: Trade;
  /** The strategy whose rules these are -- also where strategy-scoped custom
   *  field values are looked up. */
  strategyId: string;
  rules: StrategyRule[];
  /**
   * From detectAdjustments(). Null when history wasn't loaded, which makes
   * stop/target rules unevaluable rather than silently passing.
   */
  adjustments: TradeAdjustments | null;
}

/** Trims a value to a real number, or null. Tolerates the numeric strings that
 *  jsonb custom fields routinely hold. */
function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "yes") return true;
    if (v === "false" || v === "no") return false;
  }
  return null;
}

/** Tag and multi-select fields hold arrays; everything else is treated as a
 *  single-item list so `contains` works uniformly. */
function toTextList(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    const items = value.filter((v): v is string => typeof v === "string");
    return items.length > 0 ? items : null;
  }
  if (typeof value === "string" && value.trim() !== "") return [value];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  return null;
}

interface ResolvedSubject {
  value: unknown;
  /** Present when the subject itself couldn't be resolved at all. */
  reason?: string;
  caveat?: string;
}

/**
 * Finds the value a rule is about.
 *
 * The three sources are kept distinct rather than merged into one namespace so
 * a custom field whose key happens to be `risk_percent` can never be read as
 * the column of that name.
 */
function resolveSubject(rule: StrategyRule, input: EvaluationInput): ResolvedSubject {
  const { trade, strategyId, adjustments } = input;

  if (rule.subject_source === "core") {
    if (!findCoreSubject(rule.subject_key)) {
      return { value: null, reason: "This rule points at a field that no longer exists." };
    }
    return { value: (trade as unknown as Record<string, unknown>)[rule.subject_key] ?? null };
  }

  if (rule.subject_source === "derived") {
    if (rule.subject_key === "holding_days") {
      return { value: holdingDays(trade) };
    }
    if (rule.subject_key === "stop_moved" || rule.subject_key === "target_moved") {
      if (!adjustments) {
        return { value: null, reason: "The trade's edit history wasn't available." };
      }
      const moved =
        rule.subject_key === "stop_moved" ? adjustments.stopMoved : adjustments.targetMoved;
      return {
        value: moved,
        // A negative rests on retained snapshots, which migration 0023 caps.
        // Saying so is the difference between reporting evidence and asserting
        // a fact the data cannot support.
        caveat:
          !moved && adjustments.mayBeTruncated
            ? "Based on retained edit history, which may not go back to the start of this trade."
            : undefined,
      };
    }
    return { value: null, reason: "This rule points at a measure that no longer exists." };
  }

  // custom: a global field lives in custom_fields; a strategy-scoped one lives
  // under its strategy's id. Checked in that order because a strategy-scoped
  // field is the more specific answer when both somehow exist.
  const scoped = trade.strategy_field_values?.[strategyId]?.[rule.subject_key];
  const global = trade.custom_fields?.[rule.subject_key];
  return { value: scoped ?? global ?? null };
}

/** Human-readable rendering of what was actually found. */
function formatActual(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "number") return String(Number(value.toFixed(4)));
  const text = String(value).trim();
  return text === "" ? null : text.slice(0, 120);
}

/** A value counts as "set" if it is present and not blank. Zero and false are
 *  SET -- they are recorded answers, not missing ones. */
function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function evaluateRule(rule: StrategyRule, input: EvaluationInput): RuleEvaluation {
  const unevaluable = (reason: string): RuleEvaluation => ({
    rule,
    outcome: "unevaluable",
    actual: null,
    reason,
  });

  const { value, reason, caveat } = resolveSubject(rule, input);
  if (reason) return unevaluable(reason);

  const actual = formatActual(value);
  const decide = (outcome: RuleOutcome): RuleEvaluation => ({
    rule,
    outcome,
    actual,
    reason: null,
    caveat,
  });

  // Presence checks come first: they are the only operators that treat a
  // missing value as a legitimate answer rather than as a reason to skip.
  if (rule.operator === "is_set") return decide(isPresent(value) ? "pass" : "fail");
  if (rule.operator === "is_not_set") return decide(isPresent(value) ? "fail" : "pass");

  if (!isPresent(value)) {
    return unevaluable("Not recorded on this trade.");
  }

  switch (rule.operator) {
    case "is_true":
    case "is_false": {
      const bool = toBoolean(value);
      if (bool === null) return unevaluable("This value isn't a yes/no.");
      return decide(bool === (rule.operator === "is_true") ? "pass" : "fail");
    }

    case "text_eq":
    case "text_neq": {
      const expected = (rule.text_value ?? "").trim().toLowerCase();
      if (expected === "") return unevaluable("This rule has no value to compare against.");
      const list = toTextList(value);
      if (!list) return unevaluable("This value isn't text.");
      const matches = list.some((item) => item.trim().toLowerCase() === expected);
      return decide(matches === (rule.operator === "text_eq") ? "pass" : "fail");
    }

    case "contains": {
      const needle = (rule.text_value ?? "").trim().toLowerCase();
      if (needle === "") return unevaluable("This rule has no value to look for.");
      const list = toTextList(value);
      if (!list) return unevaluable("This value isn't text.");
      // Membership for a tag list, substring for a single string -- which is
      // what "contains" means in each case to the person who wrote the rule.
      const found = list.some(
        (item) => item.trim().toLowerCase() === needle || item.toLowerCase().includes(needle),
      );
      return decide(found ? "pass" : "fail");
    }

    default: {
      const actualNumber = toNumber(value);
      if (actualNumber === null) return unevaluable("This value isn't a number.");

      const target = rule.number_value;
      if (target === null) return unevaluable("This rule has no value to compare against.");

      switch (rule.operator) {
        case "lte":
          return decide(actualNumber <= target ? "pass" : "fail");
        case "lt":
          return decide(actualNumber < target ? "pass" : "fail");
        case "gte":
          return decide(actualNumber >= target ? "pass" : "fail");
        case "gt":
          return decide(actualNumber > target ? "pass" : "fail");
        case "eq":
          return decide(actualNumber === target ? "pass" : "fail");
        case "neq":
          return decide(actualNumber !== target ? "pass" : "fail");
        case "between": {
          const max = rule.number_value_max;
          if (max === null) return unevaluable("This rule has no upper bound.");
          // Inclusive at both ends: a trader writing "hold 3-7 days" means a
          // 3-day hold complies.
          const low = Math.min(target, max);
          const high = Math.max(target, max);
          return decide(actualNumber >= low && actualNumber <= high ? "pass" : "fail");
        }
        default:
          return unevaluable("This rule uses a comparison this version doesn't understand.");
      }
    }
  }
}

/**
 * Scores one trade against one strategy's rules.
 *
 * Disabled rules are dropped entirely rather than reported as skipped: a rule
 * the trader switched off is not part of the plan right now, and listing it
 * would imply it still counts.
 */
export function evaluateStrategyRules(
  input: EvaluationInput,
  strategyName: string,
): StrategyAdherence {
  const evaluations = input.rules
    .filter((rule) => rule.enabled)
    .map((rule) => evaluateRule(rule, input));

  const passed = evaluations.filter((e) => e.outcome === "pass").length;
  const failed = evaluations.filter((e) => e.outcome === "fail").length;
  const unevaluable = evaluations.filter((e) => e.outcome === "unevaluable").length;
  const checked = passed + failed;

  return {
    strategyId: input.strategyId,
    strategyName,
    evaluations,
    passed,
    failed,
    unevaluable,
    // Unevaluable rules are OUT of the denominator -- see the header. Null
    // rather than 0 when nothing was checkable, so the UI can render "—"
    // instead of a 0% that reads as total failure.
    score: checked === 0 ? null : passed / checked,
  };
}
