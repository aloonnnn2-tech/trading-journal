import { describe, expect, it } from "vitest";
import { MAX_BACKFILL_MONTHS, costInAccountCurrency, dueMonths, monthLabel, nextDue } from "./due";

const cost = (over: Partial<{ day_of_month: number; starts_on: string; active: boolean }> = {}) => ({
  day_of_month: 1,
  starts_on: "2026-09-01",
  active: true,
  ...over,
});

describe("dueMonths", () => {
  it("takes a month once its day has arrived, and not before", () => {
    expect(dueMonths(cost({ day_of_month: 15 }), "2026-09-14")).toEqual([]);
    expect(dueMonths(cost({ day_of_month: 15 }), "2026-09-15")).toEqual(["2026-09-01"]);
  });

  it("doesn't charge the month a cost starts in if its day already passed", () => {
    expect(dueMonths(cost({ day_of_month: 1, starts_on: "2026-09-10" }), "2026-09-29")).toEqual([]);
    expect(dueMonths(cost({ day_of_month: 1, starts_on: "2026-09-10" }), "2026-10-01")).toEqual(["2026-10-01"]);
  });

  it("catches up on every missed month across a year end", () => {
    expect(dueMonths(cost({ starts_on: "2026-11-01" }), "2027-02-03")).toEqual([
      "2026-11-01",
      "2026-12-01",
      "2027-01-01",
      "2027-02-01",
    ]);
  });

  it("never takes more than a year of back months at once", () => {
    expect(dueMonths(cost({ starts_on: "2020-01-01" }), "2026-09-29")).toHaveLength(MAX_BACKFILL_MONTHS);
  });

  it("takes nothing while paused", () => {
    expect(dueMonths(cost({ active: false }), "2026-12-01")).toEqual([]);
  });
});

describe("nextDue", () => {
  it("is this month's day if still ahead, else next month's", () => {
    expect(nextDue(cost({ day_of_month: 15 }), "2026-09-10")).toBe("2026-09-15");
    expect(nextDue(cost({ day_of_month: 15 }), "2026-09-20")).toBe("2026-10-15");
    expect(nextDue(cost({ day_of_month: 5 }), "2026-12-20")).toBe("2027-01-05");
  });

  it("waits for a start date in the future", () => {
    expect(nextDue(cost({ starts_on: "2026-11-20", day_of_month: 1 }), "2026-09-29")).toBe("2026-12-01");
  });
});

describe("helpers", () => {
  it("converts a foreign-currency cost at its stored rate, to the cent", () => {
    expect(costInAccountCurrency({ amount: 29, currency: null, fx_rate: null })).toBe(29);
    expect(costInAccountCurrency({ amount: 100, currency: "ILS", fx_rate: 0.2712 })).toBe(27.12);
  });

  it("labels months without the runtime's locale", () => {
    expect(monthLabel("2026-09-01")).toBe("Sep 2026");
  });
});
