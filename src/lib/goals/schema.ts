import { z } from "zod";
import { NUMERIC_OPERATORS, TEXT_OPERATORS } from "@/lib/plan-rules/subjects";
import { OPERATORS, SUBJECT_SOURCES } from "@/lib/plan-rules/types";
import { GOAL_KINDS, GOAL_METRICS, GOAL_PERIODS, TARGET_DIRECTIONS } from "./evaluate";

// Validation for the goal routes.
//
// **This is where "every goal must be measurable" is enforced.** The migration
// has a check constraint for the same thing, but a constraint can only say
// which columns must be present -- it cannot say that an `lte` condition needs
// a number to compare against. Both halves are needed: the constraint stops a
// malformed row existing, and this stops one being created with a condition
// nothing could ever evaluate.

const LABEL = z
  .string()
  .trim()
  .min(1, "Give the goal a name.")
  .max(100, "That goal name is too long.");

const NUMBER = z.number().refine(Number.isFinite, "That needs to be a real number.").nullish();

const base = {
  label: LABEL,
  kind: z.enum(GOAL_KINDS),
  subject_source: z.enum(SUBJECT_SOURCES).nullish(),
  subject_key: z.string().trim().max(80).nullish(),
  operator: z.enum(OPERATORS).nullish(),
  number_value: NUMBER,
  number_value_max: NUMBER,
  text_value: z.string().trim().max(200).nullish(),
  metric: z.enum(GOAL_METRICS).nullish(),
  mistake_label: z.string().trim().max(120).nullish(),
  target: z.number().refine(Number.isFinite, "Set a target."),
  target_direction: z.enum(TARGET_DIRECTIONS),
  period: z.enum(GOAL_PERIODS),
  active: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(100_000).optional(),
};

type GoalInput = {
  kind: (typeof GOAL_KINDS)[number];
  subject_source?: string | null;
  subject_key?: string | null;
  operator?: (typeof OPERATORS)[number] | null;
  number_value?: number | null;
  number_value_max?: number | null;
  text_value?: string | null;
  metric?: string | null;
  mistake_label?: string | null;
};

/** Each kind needs its own fields, and an adherence condition additionally
 *  needs whatever operand its operator compares against. */
function checkShape(data: GoalInput, ctx: z.RefinementCtx) {
  if (data.kind === "adherence") {
    if (!data.subject_source || !data.subject_key || !data.operator) {
      ctx.addIssue({ code: "custom", path: ["subject_key"], message: "Pick what this goal checks." });
      return;
    }
    if (NUMERIC_OPERATORS.has(data.operator) && data.number_value == null) {
      ctx.addIssue({ code: "custom", path: ["number_value"], message: "Enter the value to compare against." });
    }
    if (data.operator === "between" && data.number_value_max == null) {
      ctx.addIssue({ code: "custom", path: ["number_value_max"], message: "Enter the upper end of the range." });
    }
    if (TEXT_OPERATORS.has(data.operator) && !data.text_value?.trim()) {
      ctx.addIssue({ code: "custom", path: ["text_value"], message: "Enter the text to compare against." });
    }
  }

  if (data.kind === "aggregate" && !data.metric) {
    ctx.addIssue({ code: "custom", path: ["metric"], message: "Pick what to measure." });
  }

  if (data.kind === "reduction" && !data.mistake_label?.trim()) {
    ctx.addIssue({ code: "custom", path: ["mistake_label"], message: "Pick which mistake to reduce." });
  }
}

export const goalCreateSchema = z.object(base).superRefine(checkShape);

/** PATCH replaces the whole definition, for the same reason as plan rules:
 *  changing `kind` alone cannot be validated against fields this schema
 *  cannot see. */
export const goalPatchSchema = z.object(base).superRefine(checkShape);

export type GoalPayload = z.infer<typeof goalCreateSchema>;

/**
 * Turns validated input into the row shape.
 *
 * Optional condition fields become explicit nulls: `undefined` would leave a
 * column untouched on an update, which for a goal that changed kind means
 * keeping a stale condition alongside the new one.
 */
export function toGoalRow(data: GoalPayload) {
  return {
    label: data.label,
    kind: data.kind,
    subject_source: data.subject_source ?? null,
    subject_key: data.subject_key ?? null,
    operator: data.operator ?? null,
    number_value: data.number_value ?? null,
    number_value_max: data.number_value_max ?? null,
    text_value: data.text_value ?? null,
    metric: data.metric ?? null,
    mistake_label: data.mistake_label ?? null,
    target: data.target,
    target_direction: data.target_direction,
    period: data.period,
    active: data.active ?? true,
    sort_order: data.sort_order ?? 0,
  };
}
