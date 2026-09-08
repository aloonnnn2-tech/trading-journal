import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "./format";

// The property under test is *determinism*, not prettiness: these strings are
// rendered on the server and again in the browser, and the two must agree
// character for character or React throws away the subtree.

describe("formatDate", () => {
  it("formats unambiguously", () => {
    expect(formatDate("2026-09-05T17:05:23")).toBe("5 Sep 2026");
  });

  it("never produces a numeric month, which reads differently by country", () => {
    // 9/5/2026 is the 9th of May in most of the world and the 5th of
    // September in the US. The month name removes the question.
    expect(formatDate("2026-09-05T00:00:00")).toContain("Sep");
    expect(formatDate("2026-05-09T00:00:00")).toContain("May");
  });

  it("does not depend on the runtime locale", () => {
    // The whole point: the same input must give the same output whatever
    // Intl would have done.
    const iso = "2026-01-31T12:00:00";
    expect(formatDate(iso)).toBe(formatDate(new Date(iso)));
    expect(formatDate(iso)).toBe("31 Jan 2026");
  });

  it("renders an em dash for nothing rather than 'Invalid Date'", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("not a date")).toBe("—");
  });
});

describe("formatDateTime", () => {
  it("pads the time and uses 24-hour", () => {
    // am/pm is locale wording, so it is avoided entirely.
    expect(formatDateTime("2026-09-05T09:07:00")).toBe("5 Sep 2026, 09:07");
    expect(formatDateTime("2026-09-05T17:05:23")).toBe("5 Sep 2026, 17:05");
  });

  it("handles midnight without collapsing to a single digit", () => {
    expect(formatDateTime("2026-09-05T00:00:00")).toBe("5 Sep 2026, 00:00");
  });

  it("falls back for nothing", () => {
    expect(formatDateTime(null)).toBe("—");
  });
});
