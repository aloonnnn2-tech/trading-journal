import { z } from "zod";
import { NUMERIC_OPERATORS, TEXT_OPERATORS } from "./subjects";
import { OPERATORS, SUBJECT_SOURCES } from "./types";

// Validation for the plan-rule routes.
//
// **This file is where the operator-to-operand pairing is enforced** -- that
// `lte` needs a number, `between` needs two, and `contains` needs text. The
// migration deliberately leaves those columns nullable rather than expressing
// every valid combination as a check constraint: that constraint would be long,
// unreadable, and a second copy of this logic that could disagree with it.
//
// The consequence is that a rule saved through any other path could be
// incoherent, so the evaluator treats a missing operand as *unevaluable*
// rather than trusting that validation happened. Both halves are needed: this
// stops bad rules being created, and the evaluator stops a bad rule breaking
// the page if one ever exists.

const LABEL = z
  .string()
  .trim()
  .min(1, "Give the rule a name.")
  .max(100, "That rule name is too long.");

// Bounded well above any real column or field key, but bounded -- this string
// is used to look up a value by name, so an unbounded one is a pointless
// megabyte in a text column.
const SUBJECT_KEY = z
  .string()
  .trim()
  .min(1, "Pick what the rule checks.")
  .max(80, "That field name is too long.");

// Finite so NaN and Infinity can never reach a numeric column or a comparison.
const NUMBER = z
  .number()
  .refine(Number.isFinite, "That needs to be a real number.")
  .nullish();

const TEXT_VALUE = z.string().trim().max(200, "That value is too long.").nullish();

const baseFields = {
  label: LABEL,
  subject_source: z.enum(SUBJECT_SOURCES),
  subject_key: SUBJECT_KEY,
  operator: z.enum(OPERATORS),
  number_value: NUMBER,
  number_value_max: NUMBER,
  text_value: TEXT_VALUE,
  enabled: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(100_000).optional(),
};

/** Shared by create and patch: a rule must carry the operands its operator
 *  actually uses, or it can never be evaluated and would sit on the trade card
 *  permanently reporting "this rule has no value to compare against". */
function checkOperands(
  data: {
    operator: (typeof OPERATORS)[number];
    number_value?: number | null;
    number_value_max?: number | null;
    text_value?: string | null;
  },
  ctx: z.RefinementCtx,
) {
  if (NUMERIC_OPERATORS.has(data.operator) && data.number_value == null) {
    ctx.addIssue({
      code: "custom",
      path: ["number_value"],
      message: "Enter the value to compare against.",
    });
  }
  if (data.operator === "between" && data.number_value_max == null) {
    ctx.addIssue({
      code: "custom",
      path: ["number_value_max"],
      message: "Enter the upper end of the range.",
    });
  }
  if (TEXT_OPERATORS.has(data.operator) && !data.text_value?.trim()) {
    ctx.addIssue({
      code: "custom",
      path: ["text_value"],
      message: "Enter the text to compare against.",
    });
  }
}

export const ruleCreateSchema = z
  .object({ strategy_id: z.uuid("Pick which strategy this rule belongs to."), ...baseFields })
  .superRefine(checkOperands);

/**
 * PATCH replaces the whole rule definition rather than accepting arbitrary
 * partial fields.
 *
 * A partial patch cannot be validated: changing `operator` alone from `lte` to
 * `between` would need the stored `number_value_max` to be checked, which this
 * schema can't see. Requiring the full definition keeps every saved rule
 * coherent by construction. `strategy_id` is deliberately absent -- moving a
 * rule between strategies is a different operation, and allowing it here would
 * let a PATCH reassign a rule to a strategy the request never named.
 */
export const rulePatchSchema = z.object(baseFields).superRefine(checkOperands);
