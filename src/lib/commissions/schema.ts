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
    // Size bands (see FeeTier). At most 10: a real schedule has 3-5.
    tiers: z
      .array(
        z.object({
          up_to: z.number().finite().positive().nullable(),
          amount: z.number().finite().min(0, "A band's amount can't be negative"),
        }),
      )
      .max(10)
      .nullable()
      .optional(),
    tier_by: z.enum(["value", "shares"]).optional(),
    only_when: z
      .object({
        order_types: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
        direction: z.enum(["long", "short"]).optional(),
        price_below: z.number().finite().positive().nullable().optional(),
        price_at_least: z.number().finite().min(0).nullable().optional(),
      })
      .strict()
      .nullable()
      .optional(),
    // ISO 4217-shaped code; the rate is account-currency units per one of it.
    currency: z.string().trim().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code").nullable().optional(),
    fx_rate: z.number().finite().positive().max(100000).nullable().optional(),
    fx_rate_date: z.string().max(40).nullable().optional(),
    taken_from: z.enum(["cash", "shares"]).optional(),
  })
  .refine((c) => !c.currency || (c.fx_rate != null && c.fx_rate > 0), {
    message: "A fee in another currency needs its exchange rate",
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
