import { describe, expect, it } from "vitest";
import {
  parseDateString,
  periodLengthDays,
  previousPeriod,
  resolvePeriod,
  resolveRequestedPeriod,
} from "./period";

// Timezone correctness is the whole risk in this file. This app has already
// shipped -- and fixed -- two bugs where a UTC day was used where the
// trader's local day was meant, so every test below pins a zone west of UTC
// (where the two disagree every evening) rather than running in whatever zone
// the CI box happens to be set to.

const NY = "America/New_York";

describe("resolvePeriod — weekly", () => {
  it("covers the seven local days ending today", () => {
    // 09:00 UTC on 1 Sep is still 1 Sep in New York, so today is the 1st.
    const period = resolvePeriod("weekly", NY, new Date("2026-09-01T09:00:00Z"));
    expect(period).not.toBeNull();
    expect(period!.startDate).toBe("2026-08-26");
    expect(period!.endDate).toBe("2026-09-01");
    expect(periodLengthDays(period!)).toBe(7);
  });

  it("uses the trader's local day, not UTC's", () => {
    // 02:00 UTC on 1 Sep is still 31 Aug, 10pm in New York. A trader there
    // would say today is the 31st, and their week ends then.
    const period = resolvePeriod("weekly", NY, new Date("2026-09-01T02:00:00Z"));
    expect(period!.endDate).toBe("2026-08-31");

    const utc = resolvePeriod("weekly", "UTC", new Date("2026-09-01T02:00:00Z"));
    expect(utc!.endDate).toBe("2026-09-01");
  });

  it("bounds the window with a half-open UTC range", () => {
    const period = resolvePeriod("weekly", NY, new Date("2026-09-01T09:00:00Z"));
    // Midnight local on the first day, and midnight local on the day AFTER
    // the last -- so the final day is fully included and nothing is counted
    // in two consecutive periods.
    expect(period!.startIso).toBe("2026-08-26T04:00:00.000Z");
    expect(period!.endIso).toBe("2026-09-02T04:00:00.000Z");
  });
});

describe("resolvePeriod — monthly", () => {
  it("covers the previous whole calendar month", () => {
    const period = resolvePeriod("monthly", NY, new Date("2026-09-15T12:00:00Z"));
    expect(period!.startDate).toBe("2026-08-01");
    expect(period!.endDate).toBe("2026-08-31");
    expect(period!.label).toBe("August 2026");
  });

  it("steps back across a year boundary", () => {
    const period = resolvePeriod("monthly", NY, new Date("2026-01-10T12:00:00Z"));
    expect(period!.startDate).toBe("2025-12-01");
    expect(period!.endDate).toBe("2025-12-31");
    expect(period!.label).toBe("December 2025");
  });

  it("gets February's length right in a leap year", () => {
    const period = resolvePeriod("monthly", NY, new Date("2028-03-05T12:00:00Z"));
    expect(period!.endDate).toBe("2028-02-29");
    expect(periodLengthDays(period!)).toBe(29);
  });
});

describe("resolvePeriod — custom", () => {
  it("accepts a valid range", () => {
    const period = resolvePeriod("custom", NY, new Date(), {
      startDate: "2026-07-01",
      endDate: "2026-07-15",
    });
    expect(periodLengthDays(period!)).toBe(15);
    expect(period!.label).toBe("1 Jul – 15 Jul 2026");
  });

  it("labels a range spanning two years with both", () => {
    const period = resolvePeriod("custom", NY, new Date(), {
      startDate: "2025-12-28",
      endDate: "2026-01-03",
    });
    expect(period!.label).toBe("28 Dec 2025 – 3 Jan 2026");
  });

  it("rejects a backwards range", () => {
    expect(
      resolvePeriod("custom", NY, new Date(), {
        startDate: "2026-07-15",
        endDate: "2026-07-01",
      }),
    ).toBeNull();
  });

  it("accepts a single day", () => {
    const period = resolvePeriod("custom", NY, new Date(), {
      startDate: "2026-07-01",
      endDate: "2026-07-01",
    });
    expect(periodLengthDays(period!)).toBe(1);
  });

  it("rejects a missing or malformed range", () => {
    expect(resolvePeriod("custom", NY, new Date())).toBeNull();
    expect(
      resolvePeriod("custom", NY, new Date(), { startDate: "01/07/2026", endDate: "2026-07-15" }),
    ).toBeNull();
  });
});

describe("parseDateString", () => {
  it("rejects a date that doesn't exist", () => {
    // Date would silently roll this into 3 March, producing a period the user
    // never asked for.
    expect(parseDateString("2026-02-31")).toBeNull();
    expect(parseDateString("2026-13-01")).toBeNull();
  });

  it("accepts a real leap day", () => {
    expect(parseDateString("2028-02-29")).toEqual({ year: 2028, month: 1, day: 29 });
  });
});

describe("previousPeriod", () => {
  it("steps a week back by exactly its own length, with no gap or overlap", () => {
    const period = resolvePeriod("weekly", NY, new Date("2026-09-01T09:00:00Z"))!;
    const prev = previousPeriod(period, NY)!;

    expect(prev.startDate).toBe("2026-08-19");
    expect(prev.endDate).toBe("2026-08-25");
    // The previous window must end the day before this one starts: any gap
    // loses trades from the comparison, any overlap counts them twice.
    expect(prev.endIso).toBe(period.startIso);
  });

  it("steps a month back to the whole previous calendar month", () => {
    // Not "the 31 days before August", which would straddle June and July and
    // compare August against a window nobody recognises.
    const period = resolvePeriod("monthly", NY, new Date("2026-09-15T12:00:00Z"))!;
    const prev = previousPeriod(period, NY)!;

    expect(prev.startDate).toBe("2026-07-01");
    expect(prev.endDate).toBe("2026-07-31");
    expect(prev.label).toBe("July 2026");
  });

  it("steps a month back across a year boundary", () => {
    const period = resolvePeriod("monthly", NY, new Date("2026-02-10T12:00:00Z"))!;
    const prev = previousPeriod(period, NY)!;
    expect(prev.label).toBe("December 2025");
  });

  it("steps a custom range back by its own length", () => {
    const period = resolvePeriod("custom", NY, new Date(), {
      startDate: "2026-07-10",
      endDate: "2026-07-19",
    })!;
    const prev = previousPeriod(period, NY)!;

    expect(prev.startDate).toBe("2026-06-30");
    expect(prev.endDate).toBe("2026-07-09");
    expect(periodLengthDays(prev)).toBe(periodLengthDays(period));
  });
});

describe("resolveRequestedPeriod", () => {
  const NOW = new Date("2026-11-20T12:00:00Z");

  it("computes the window itself when no dates are given", () => {
    const period = resolveRequestedPeriod("weekly", NY, NOW)!;
    expect(period.endDate).toBe("2026-11-20");
  });

  it("re-runs an old week over the week it actually covered", () => {
    // The regenerate path. Re-resolving "weekly" here would review November
    // under an August heading -- a different period under the same name.
    const period = resolveRequestedPeriod("weekly", NY, NOW, {
      startDate: "2026-08-19",
      endDate: "2026-08-25",
    })!;

    expect(period.startDate).toBe("2026-08-19");
    expect(period.endDate).toBe("2026-08-25");
    // And it stays filed as a weekly review, not reclassified as custom.
    expect(period.kind).toBe("weekly");
  });

  it("keeps a monthly review monthly when regenerated", () => {
    const period = resolveRequestedPeriod("monthly", NY, NOW, {
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    })!;
    expect(period.kind).toBe("monthly");
    expect(period.label).toBe("August 2026");
    // The comparison still steps back a whole calendar month, because kind
    // survived the round trip.
    expect(previousPeriod(period, NY)!.label).toBe("July 2026");
  });

  it("still rejects an impossible or backwards explicit range", () => {
    expect(
      resolveRequestedPeriod("weekly", NY, NOW, {
        startDate: "2026-02-31",
        endDate: "2026-03-05",
      }),
    ).toBeNull();
    expect(
      resolveRequestedPeriod("weekly", NY, NOW, {
        startDate: "2026-08-25",
        endDate: "2026-08-19",
      }),
    ).toBeNull();
  });

  it("ignores a half-supplied range and falls back to the computed window", () => {
    const period = resolveRequestedPeriod("weekly", NY, NOW, { startDate: "2026-08-19" })!;
    expect(period.endDate).toBe("2026-11-20");
  });
});
