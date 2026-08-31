import { describe, expect, it } from "vitest";
import { coreFieldsSchema } from "./schema";

// Boundaries this schema is the only thing enforcing. Postgres `text` is
// unbounded and the date columns only reject a bad value once it reaches the
// database, so without these the API accepted a 20,000-character ticker and a
// date of "not-a-date" -- both confirmed against a running server before the
// bounds were added.

const ok = (v: unknown) => coreFieldsSchema.safeParse(v).success;
const errFor = (v: unknown, field: string) => {
  const r = coreFieldsSchema.safeParse(v);
  return r.success ? null : r.error.issues.find((i) => i.path[0] === field)?.message ?? null;
};

describe("string fields are bounded", () => {
  it.each([
    ["ticker", 32],
    ["company_name", 200],
    ["asset_type", 64],
    ["market", 64],
  ])("rejects %s beyond %i characters", (field, max) => {
    expect(ok({ [field]: "X".repeat(max + 1) })).toBe(false);
    expect(ok({ [field]: "X".repeat(max) })).toBe(true);
  });

  it("accepts the values real trades actually use", () => {
    expect(
      ok({ ticker: "BRK.B", company_name: "Berkshire Hathaway Inc.", market: "NYSE", asset_type: "Stock" }),
    ).toBe(true);
  });

  // The transform must survive the added length bound.
  it("still trims and upper-cases the ticker", () => {
    const parsed = coreFieldsSchema.parse({ ticker: "  aapl " });
    expect(parsed.ticker).toBe("AAPL");
  });
});

describe("dates are validated here, not by Postgres", () => {
  it("rejects an unparseable date with a message naming the reason", () => {
    expect(errFor({ entry_date: "not-a-date" }, "entry_date")).toMatch(/valid date/i);
    expect(ok({ exit_date: "tomorrow-ish" })).toBe(false);
  });

  it("accepts ISO timestamps and null", () => {
    expect(ok({ entry_date: "2026-08-31T00:00:00.000Z" })).toBe(true);
    expect(ok({ entry_date: null })).toBe(true);
  });

  // Dates the edge-case matrix calls out: boundaries and a leap day.
  it.each(["2024-02-29T00:00:00.000Z", "2026-12-31T23:59:59.000Z", "2027-01-01T00:00:00.000Z"])(
    "accepts boundary date %s",
    (d) => expect(ok({ entry_date: d })).toBe(true),
  );
});

describe("numbers must be storable, not merely finite", () => {
  it("rejects magnitudes a double cannot represent exactly", () => {
    expect(errFor({ entry_price: 1e200 }, "entry_price")).toMatch(/too large/i);
    expect(ok({ shares: Number.MAX_SAFE_INTEGER + 2 })).toBe(false);
  });

  it("accepts realistic prices, sizes and fees", () => {
    expect(ok({ entry_price: 189.42, shares: 25, commission: 1.5, risk_amount: 250 })).toBe(true);
    expect(ok({ entry_price: 0 })).toBe(true);
    expect(ok({ shares: -10 })).toBe(true); // accepted today; see compute.overflow.test
  });

  it("rejects wrong types outright", () => {
    expect(ok({ entry_price: "abc" })).toBe(false);
    expect(ok({ entry_price: [1, 2] })).toBe(false);
    expect(ok({ status: "bogus" })).toBe(false);
    expect(ok({ direction: "sideways" })).toBe(false);
  });
});
