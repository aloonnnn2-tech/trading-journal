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
