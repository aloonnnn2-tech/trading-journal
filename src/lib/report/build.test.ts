import { describe, expect, it } from "vitest";
import { PRESET_LABELS, REPORT_PRESETS, resolveReportPeriod } from "./build";

// The period resolution is what these tests protect. A report headed "August"
// that quietly covers part of July, or one that treats the rest of an
// unfinished month as flat, would misstate every figure inside it.

const NY = "America/New_York";
const NOW = new Date("2026-08-15T12:00:00Z");

describe("resolveReportPeriod", () => {
  it("runs this month up to today, not to the month's end", () => {
    // A report of a month in progress must not imply the remaining days were
    // flat -- it covers what has happened, not what will.
    const period = resolveReportPeriod("this_month", NY, undefined, NOW)!;
    expect(period.startDate).toBe("2026-08-01");
    expect(period.endDate).toBe("2026-08-15");
  });

  it("covers all of last month", () => {
    const period = resolveReportPeriod("last_month", NY, undefined, NOW)!;
    expect(period.startDate).toBe("2026-07-01");
    expect(period.endDate).toBe("2026-07-31");
    expect(period.label).toBe("July 2026");
  });

  it("steps last month across a year boundary", () => {
    const january = new Date("2026-01-10T12:00:00Z");
    const period = resolveReportPeriod("last_month", NY, undefined, january)!;
    expect(period.label).toBe("December 2025");
  });

  it("gets February right in a leap year", () => {
    const march = new Date("2028-03-05T12:00:00Z");
    expect(resolveReportPeriod("last_month", NY, undefined, march)!.endDate).toBe("2028-02-29");
  });

  it("runs the quarter and year to date", () => {
    expect(resolveReportPeriod("this_quarter", NY, undefined, NOW)!.startDate).toBe("2026-07-01");
    expect(resolveReportPeriod("this_year", NY, undefined, NOW)!.startDate).toBe("2026-01-01");
  });

  it("uses the trader's own day boundary", () => {
    // 02:00 UTC on 1 Aug is still 31 July, 10pm in New York -- so "this month"
    // there is July, not August.
    const lateJuly = new Date("2026-08-01T02:00:00Z");
    expect(resolveReportPeriod("this_month", NY, undefined, lateJuly)!.startDate).toBe("2026-07-01");
    expect(resolveReportPeriod("this_month", "UTC", undefined, lateJuly)!.startDate).toBe("2026-08-01");
  });

  it("bounds the window half-open, so a trade lands in one report only", () => {
    const period = resolveReportPeriod("last_month", NY, undefined, NOW)!;
    // Midnight local on 1 July, and midnight local on 1 August.
    expect(period.startIso).toBe("2026-07-01T04:00:00.000Z");
    expect(period.endIso).toBe("2026-08-01T04:00:00.000Z");
  });

  it("accepts a custom range and rejects a backwards one", () => {
    const good = resolveReportPeriod("custom", NY, { startDate: "2026-05-01", endDate: "2026-05-31" }, NOW);
    expect(good!.label).toBe("May 2026");

    expect(
      resolveReportPeriod("custom", NY, { startDate: "2026-05-31", endDate: "2026-05-01" }, NOW),
    ).toBeNull();
  });

  it("returns null for a custom range with no dates", () => {
    expect(resolveReportPeriod("custom", NY, undefined, NOW)).toBeNull();
  });

  it("labels every preset", () => {
    for (const preset of REPORT_PRESETS) expect(PRESET_LABELS[preset]).toBeTruthy();
  });
});
