import { z } from "zod";
import { NUMERIC_OPERATORS, TEXT_OPERATORS } from "@/lib/plan-rules/subjects";
import { OPERATORS, SUBJECT_SOURCES } from "@/lib/plan-rules/types";
import { ENTRY_TEMPLATES, RULE_DIRECTIONS, RULE_KINDS } from "./types";

// Validation for /api/overall-rules. Like the strategy-rule schema, this is
// where each kind's required parts are enforced; 0081's kind_shape check is
// the backstop. Create and PATCH take the whole definition, so every saved
// rule is coherent by construction.

// Labels and text rules reach AI prompts: no control characters (newlines
// excepted in a text rule's words), bounded length.
const noControl = (allowNewlines: boolean) => (v: string) =>
  !(allowNewlines ? /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(v);

const NUMBER = z.number().refine(Number.isFinite, "That needs to be a real number.").nullish();
const PERIOD = z.number().int("Use a whole number of days.").min(2, "At least 2 days.").max(400, "At most 400 days.");

export const overallRuleSchema = z
  .object({
    kind: z.enum(RULE_KINDS),
    label: z
      .string()
      .trim()
      .min(1, "Write the rule.")
      .max(300, "That rule is too long (300 characters at most).")
      .refine(noControl(true), "The rule can't contain that character."),
    direction: z.enum(RULE_DIRECTIONS).default("both"),
    enabled: z.boolean().optional(),
    sort_order: z.number().int().min(0).max(100_000).optional(),

    subject_source: z.enum(SUBJECT_SOURCES).nullish(),
    subject_key: z.string().trim().min(1).max(80).refine(noControl(false)).nullish(),
    operator: z.enum(OPERATORS).nullish(),
    number_value: NUMBER,
    number_value_max: NUMBER,
    text_value: z.string().trim().max(200).refine(noControl(false)).nullish(),

    ma_type: z.enum(["sma", "ema"]).nullish(),
    ma_period: PERIOD.nullish(),
    ma_type_2: z.enum(["sma", "ema"]).nullish(),
    ma_period_2: PERIOD.nullish(),
    entry_template: z.enum(ENTRY_TEMPLATES).nullish(),
    grace_days: z.number().int().min(0).max(10).optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    const need = (ok: unknown, path: string, message: string) => {
      if (ok == null || ok === "") ctx.addIssue({ code: "custom", path: [path], message });
    };
    if (r.kind === "field") {
      need(r.subject_source, "subject_source", "Pick what the rule checks.");
      need(r.subject_key, "subject_key", "Pick what the rule checks.");
      need(r.operator, "operator", "Pick how to compare.");
      if (r.operator && NUMERIC_OPERATORS.has(r.operator)) need(r.number_value, "number_value", "Enter the value to compare against.");
      if (r.operator === "between") need(r.number_value_max, "number_value_max", "Enter the upper end of the range.");
      if (r.operator && TEXT_OPERATORS.has(r.operator)) need(r.text_value?.trim(), "text_value", "Enter the text to compare against.");
    }
    if (r.kind === "ma_exit" || r.kind === "ma_entry") {
      need(r.ma_type, "ma_type", "Pick SMA or EMA.");
      need(r.ma_period, "ma_period", "Enter the number of days.");
    }
    if (r.kind === "ma_entry") {
      need(r.entry_template, "entry_template", "Pick the kind of entry rule.");
      if (r.entry_template === "ma_above_ma") {
        need(r.ma_type_2, "ma_type_2", "Pick SMA or EMA for the second average.");
        need(r.ma_period_2, "ma_period_2", "Enter the second average's days.");
        if (r.ma_period != null && r.ma_period_2 != null && r.ma_type === r.ma_type_2 && r.ma_period === r.ma_period_2) {
          ctx.addIssue({ code: "custom", path: ["ma_period_2"], message: "Compare two different averages." });
        }
      }
    }
  })
  // Only the columns the kind uses are kept, so a stray value from another
  // kind (switching kinds in the form) is never stored.
  .transform((r) => ({
    kind: r.kind,
    label: r.label,
    direction: r.direction,
    ...(r.enabled !== undefined ? { enabled: r.enabled } : {}),
    ...(r.sort_order !== undefined ? { sort_order: r.sort_order } : {}),
    subject_source: r.kind === "field" ? (r.subject_source ?? null) : null,
    subject_key: r.kind === "field" ? (r.subject_key ?? null) : null,
    operator: r.kind === "field" ? (r.operator ?? null) : null,
    number_value: r.kind === "field" ? (r.number_value ?? null) : null,
    number_value_max: r.kind === "field" ? (r.number_value_max ?? null) : null,
    text_value: r.kind === "field" ? (r.text_value ?? null) : null,
    ma_type: r.kind === "ma_exit" || r.kind === "ma_entry" ? (r.ma_type ?? null) : null,
    ma_period: r.kind === "ma_exit" || r.kind === "ma_entry" ? (r.ma_period ?? null) : null,
    ma_type_2: r.kind === "ma_entry" && r.entry_template === "ma_above_ma" ? (r.ma_type_2 ?? null) : null,
    ma_period_2: r.kind === "ma_entry" && r.entry_template === "ma_above_ma" ? (r.ma_period_2 ?? null) : null,
    entry_template: r.kind === "ma_entry" ? (r.entry_template ?? null) : null,
    grace_days: r.kind === "ma_exit" ? (r.grace_days ?? 1) : 1,
  }));

export type OverallRuleInput = z.output<typeof overallRuleSchema>;
