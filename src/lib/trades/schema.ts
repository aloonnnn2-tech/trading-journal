import { z } from "zod";

// Runtime validator for the PATCH /api/trades/[id] `core` payload -- mirrors
// buildCustomFieldsSchema in @/lib/fields/schema, so bad enum/numeric/date
// values are rejected with a clean 400 instead of reaching Postgres and
// surfacing as an unhandled 500.
// Finite alone is not enough. Past MAX_SAFE_INTEGER a double can no longer
// represent consecutive integers, and multiplying two such values (price x
// shares) overflows to Infinity -- which JSON.stringify sends to Postgres as
// null, silently emptying the P/L on a request that reported success. Same
// bound as the CSV importer's parseCoreValue, so both entry points agree on
// what counts as a usable number.
const nullableFiniteNumber = z
  .number()
  .finite()
  .refine((n) => Math.abs(n) <= Number.MAX_SAFE_INTEGER, {
    message: "number is too large to store accurately",
  })
  .nullable();
// Postgres `text` is unbounded and nothing else capped these, so a PATCH stored
// whatever it was given -- 20,000 characters went in verbatim, confirmed
// against a running server. Storage is the least of it: all four render in the
// trades table and on the trade card, and they ride into every CSV/XLSX export.
// The bounds are far above any genuine value (the longest real ticker is five
// characters, the longest S&P company name about forty) while keeping a pasted
// document out of a single cell.
const boundedString = (max: number) => z.string().max(max).nullable();

// The header above promises dates are rejected here, but `entry_date` and
// `exit_date` were plain strings: "not-a-date" passed validation and was only
// caught by Postgres, surfacing as a generic "Failed to update trade" that
// names neither the field nor the reason. Validating here keeps that promise
// and returns an error the caller can act on.
const nullableDate = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), { message: "must be a valid date" })
  .nullable();

export const coreFieldsSchema = z
  .object({
    mode: z.enum(["trade", "investment"]),
    ticker: z.string().max(32).transform((v) => v.trim().toUpperCase()),
    company_name: boundedString(200),
    asset_type: boundedString(64),
    market: boundedString(64),
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
    commission: nullableFiniteNumber,
    entry_date: nullableDate,
    exit_date: nullableDate,
  })
  .partial();
