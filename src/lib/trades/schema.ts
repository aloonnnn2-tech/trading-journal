import { z } from "zod";

// Runtime validator for the PATCH /api/trades/[id] `core` payload -- mirrors
// buildCustomFieldsSchema in @/lib/fields/schema, so bad enum/numeric/date
// values are rejected with a clean 400 instead of reaching Postgres and
// surfacing as an unhandled 500.
const nullableFiniteNumber = z.number().finite().nullable();
const nullableString = z.string().nullable();

export const coreFieldsSchema = z
  .object({
    mode: z.enum(["trade", "investment"]),
    ticker: z.string().transform((v) => v.trim().toUpperCase()),
    company_name: nullableString,
    asset_type: nullableString,
    market: nullableString,
    direction: z.enum(["long", "short"]).nullable(),
    status: z.enum(["pending", "open", "closed"]),
    result: z.enum(["open", "win", "loss", "break_even"]),
    entry_price: nullableFiniteNumber,
    exit_price: nullableFiniteNumber,
    stop_loss: nullableFiniteNumber,
    take_profit: nullableFiniteNumber,
    shares: nullableFiniteNumber,
    position_size: nullableFiniteNumber,
    dollar_amount: nullableFiniteNumber,
    risk_amount: nullableFiniteNumber,
    risk_percent: nullableFiniteNumber,
    entry_date: nullableString,
    exit_date: nullableString,
  })
  .partial();
