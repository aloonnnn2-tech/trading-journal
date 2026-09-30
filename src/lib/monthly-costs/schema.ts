import { z } from "zod";

export const monthlyCostSchema = z
  .object({
    name: z.string().trim().min(1, "Give it a name").max(80),
    amount: z.number().finite().positive("The amount must be more than 0").max(9999999),
    currency: z.string().trim().regex(/^[A-Z]{3}$/).nullable(),
    fx_rate: z.number().finite().positive().max(100000).nullable(),
    day_of_month: z.number().int().min(1).max(28),
    starts_on: z.iso.date(),
    active: z.boolean(),
  })
  .strict()
  .refine((c) => !c.currency || c.fx_rate != null, { message: "A cost in another currency needs its exchange rate" });

export const monthlyCostPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    amount: z.number().finite().positive().max(9999999),
    currency: z.string().trim().regex(/^[A-Z]{3}$/).nullable(),
    fx_rate: z.number().finite().positive().max(100000).nullable(),
    day_of_month: z.number().int().min(1).max(28),
    starts_on: z.iso.date(),
    active: z.boolean(),
  })
  .partial()
  .strict();
