import { describe, it, expect } from "vitest";
import { localDateParts, startOfLocalDayIso, getLocalDayOfMonth } from "./local-day";

// Why this module exists: bucketing by UTC misfiled every evening trade for
// anyone west of UTC -- a trade closed 7pm EST is already "tomorrow" in UTC,
// so the dashboard's headline number disagreed with the trade just logged.

describe("localDateParts", () => {
  it("reports the calendar day showing on a clock in that zone", () => {
    // 00:30 UTC on the 2nd is still 7:30pm on the 1st in New York.
    const instant = new Date("2026-07-02T00:30:00Z");
    expect(localDateParts(instant, "America/New_York")).toEqual({ year: 2026, month: 6, day: 1 });
    expect(localDateParts(instant, "UTC")).toEqual({ year: 2026, month: 6, day: 2 });
  });

  it("falls back to UTC when no timezone has been detected yet", () => {
    const instant = new Date("2026-07-02T00:30:00Z");
    expect(localDateParts(instant, null)).toEqual(localDateParts(instant, "UTC"));
  });

  it("handles a zone ahead of UTC", () => {
    // 22:00 UTC is already the next morning in Tokyo.
    expect(localDateParts(new Date("2026-07-01T22:00:00Z"), "Asia/Tokyo")).toEqual({
      year: 2026,
      month: 6,
      day: 2,
    });
  });
});

describe("startOfLocalDayIso", () => {
  it("returns the UTC instant at which that local day begins", () => {
    // Midnight July 1 in New York (EDT, UTC-4) is 04:00 UTC.
    expect(startOfLocalDayIso(2026, 6, 1, "America/New_York")).toBe("2026-07-01T04:00:00.000Z");
  });

  it("round-trips: the start of a day maps back to that same day", () => {
    const zones = ["UTC", "America/New_York", "Asia/Tokyo", "Australia/Adelaide", "Asia/Kathmandu", "Europe/London"];
    for (const tz of zones) {
      for (const [year, month, day] of [
        [2026, 0, 1],
        [2026, 6, 15],
        [2026, 11, 31],
        [2024, 1, 29], // leap day
      ] as const) {
        const iso = startOfLocalDayIso(year, month, day, tz);
        expect(localDateParts(new Date(iso), tz)).toEqual({ year, month, day });
      }
    }
  });

  // Half-hour and quarter-hour offsets are where naive implementations break.
  it("handles non-hour offsets", () => {
    expect(localDateParts(new Date(startOfLocalDayIso(2026, 5, 10, "Asia/Kathmandu")), "Asia/Kathmandu")).toEqual({
      year: 2026,
      month: 5,
      day: 10,
    });
    expect(localDateParts(new Date(startOfLocalDayIso(2026, 5, 10, "Asia/Kolkata")), "Asia/Kolkata")).toEqual({
      year: 2026,
      month: 5,
      day: 10,
    });
  });

  // The offset has to be sampled at the target instant, but finding that
  // instant needs the offset -- so this is solved in two passes. DST is
  // where a single pass lands on the wrong side by an hour.
  it("lands on real midnight across both DST transitions", () => {
    // US spring forward (2026-03-08) and fall back (2026-11-01).
    for (const [month, day] of [
      [2, 8],
      [2, 9],
      [10, 1],
      [10, 2],
    ] as const) {
      const iso = startOfLocalDayIso(2026, month, day, "America/New_York");
      expect(localDateParts(new Date(iso), "America/New_York")).toEqual({ year: 2026, month, day });
    }
  });

  it("normalizes an overflowing day into the next month", () => {
    // Callers pass `day + 1` to get an exclusive upper bound.
    const iso = startOfLocalDayIso(2026, 6, 32, "UTC");
    expect(localDateParts(new Date(iso), "UTC")).toEqual({ year: 2026, month: 7, day: 1 });
  });
});

describe("getLocalDayOfMonth", () => {
  it("buckets a timestamp by the user's calendar day, not UTC's", () => {
    expect(getLocalDayOfMonth("2026-07-02T00:30:00Z", "America/New_York")).toBe(1);
    expect(getLocalDayOfMonth("2026-07-02T00:30:00Z", "UTC")).toBe(2);
  });
});
