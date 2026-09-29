import { z } from "zod";

// Runtime validator for the commission-rule API payloads. Mirrors
// lib/trades/schema.ts's approach: reject bad values with a clean 400
// rather than letting them reach Postgres as an unhandled 500.
const nullableFiniteNumber = z.number().finite().nullable();
const nullableTrimmedString = z
  .string()
  .nullable()
  .transform((v) => {
    const trimmed = v?.trim() ?? "";
    return trimmed === "" ? null : trimmed;
  });

const nonNegativeOrNull = nullableFiniteNumber
  .optional()
  .refine((v) => v == null || v >= 0, "Fees can't be negative");

/** One line of a multi-line rule (0055). */
export const feeComponentSchema = z
  .object({
    label: z.string().trim().min(1, "Each fee line needs a name").max(60),
    basis: z.enum(["flat", "percent", "per_unit"]),
    amount: z.number().finite().min(0, "Amount can't be negative"),
    side: z.enum(["both", "entry", "exit", "buy", "sell"]),
    min_fee: nonNegativeOrNull,
    max_fee: nonNegativeOrNull,
    max_percent: nonNegativeOrNull,
  })
  .refine((c) => c.min_fee == null || c.max_fee == null || c.max_fee >= c.min_fee, {
    message: "A fee line's maximum must be at least its minimum",
  });

export const commissionRuleSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  rule_type: z.enum(["flat", "percent", "per_unit"]),
  // Negative fees would silently *add* money to a trade's P&L.
  amount: z.number().finite().min(0, "Amount can't be negative"),
  applies_to: z.enum(["both", "entry", "exit"]),
  asset_type: nullableTrimmedString,
  market: nullableTrimmedString,
  min_fee: nullableFiniteNumber.refine((v) => v == null || v >= 0, "Minimum fee can't be negative"),
  max_fee: nullableFiniteNumber.refine((v) => v == null || v >= 0, "Maximum fee can't be negative"),
  enabled: z.boolean(),
  // Up to 8 lines: the richest real schedule here (IBKR Tiered) has 5.
  components: z.array(feeComponentSchema).max(8).nullable().optional(),
  preset_id: z.string().trim().max(80).nullable().optional(),
});

export const commissionRulePatchSchema = commissionRuleSchema
  .partial()
  .extend({ sort_order: z.number().int().optional() });

/** A cap below the floor can never be satisfied -- caught here rather than
 *  silently producing a fee clamped to a contradictory range. */
export function validateFeeRange(input: {
  min_fee?: number | null;
  max_fee?: number | null;
}): string | null {
  const { min_fee, max_fee } = input;
  if (min_fee != null && max_fee != null && max_fee < min_fee) {
    return "Maximum fee must be greater than or equal to the minimum fee";
  }
  return null;
}
