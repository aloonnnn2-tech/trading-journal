import { describe, expect, it } from "vitest";
import { checkMaEntry, checkMaExit, costOfHolding, toDailyCloses, tradeDay, type DailyClose, type MarketTrade } from "./market-checks";
import type { OverallRule } from "./types";

// A 3-day SMA keeps the hand arithmetic readable: the logic is the same for 150.

function rule(over: Partial<OverallRule> = {}): OverallRule {
  return {
    id: "r1",
    label: "Exit below SMA 3",
    kind: "ma_exit",
    subject_source: null,
    subject_key: null,
    operator: null,
    number_value: null,
    number_value_max: null,
    text_value: null,
    ma_type: "sma",
    ma_period: 3,
    ma_type_2: null,
    ma_period_2: null,
    entry_template: null,
    grace_days: 1,
    direction: "both",
    enabled: true,
    sort_order: 0,
    updated_at: "2026-10-01T00:00:00Z",
    ...over,
  };
}

/** Consecutive trading days from Oct 1 (weekends aren't skipped -- the check only uses order). */
function closes(values: number[]): DailyClose[] {
  return values.map((close, i) => ({ day: `2026-10-${String(i + 1).padStart(2, "0")}`, close }));
}

function trade(over: Partial<MarketTrade> = {}): MarketTrade {
  return {
    direction: "long",
    status: "closed",
    entry_price: 10,
    exit_price: 8,
    shares: 100,
    entry_date: "2026-10-04",
    exit_date: "2026-10-09",
    ...over,
  };
}

const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}`;
const days = (entry: number, exit: number | null) => ({ entryDay: day(entry), exitDay: exit == null ? null : day(exit) });

// Day:    1   2   3   4   5   6   7   8   9   10
// Close: 10  10  10  11  12  12   9   8   8    7
// SMA3:   -   -  10 10.3 11 11.7  11 9.7 8.3 7.7
// The first close below the SMA after entry (day 4) is day 7 (9 < 11).
const series = closes([10, 10, 10, 11, 12, 12, 9, 8, 8, 7]);

describe("moving-average exit", () => {
  it("is broken when the trade was held past the grace period, with days late and the cost", () => {
    const c = checkMaExit(rule(), series, trade(), days(4, 9));
    expect(c.outcome).toBe("broken");
    expect(c.detail.trigger_date).toBe(day(7));
    expect(c.detail.deadline_date).toBe(day(8)); // 1 trading day of grace
    expect(c.detail.days_late).toBe(1);
    // Selling 100 at the deadline's close (8) vs the actual exit (8): no difference.
    expect(c.detail.cost).toBe(0);
    expect(c.detail.summary).toContain("Closed below the SMA 3 on Oct 7, 2026");
    expect(c.detail.summary).toContain("1 trading day late");
  });

  it("puts a price on holding on", () => {
    const c = checkMaExit(rule(), series, trade({ exit_date: day(10), exit_price: 7 }), days(4, 10));
    expect(c.outcome).toBe("broken");
    expect(c.detail.cost).toBe(100); // (8 - 7) x 100 shares
    expect(c.detail.summary).toContain("Selling on time would have made $100.00 more");
  });

  it("is followed when the exit came within the grace period", () => {
    expect(checkMaExit(rule(), series, trade({ exit_date: day(8) }), days(4, 8)).outcome).toBe("followed");
    expect(checkMaExit(rule(), series, trade({ exit_date: day(7) }), days(4, 7)).detail.summary).toContain("out that day");
  });

  it("is not triggered when no close crossed while the trade was open", () => {
    const c = checkMaExit(rule(), series, trade({ exit_date: day(6) }), days(4, 6));
    expect(c.outcome).toBe("not_triggered");
  });

  it("mirrors for a short: a close above the average", () => {
    // Short from day 8; closes 8, 8, 7 stay under the SMA -> never triggers.
    expect(checkMaExit(rule(), series, trade({ direction: "short", exit_date: day(10) }), days(8, 10)).outcome).toBe(
      "not_triggered",
    );
    // Short from day 3: day 4's 11 is above its SMA (10.33) -> trigger day 4, deadline day 5, out day 9.
    const c = checkMaExit(rule(), series, trade({ direction: "short", exit_date: day(9), exit_price: 8 }), days(3, 9));
    expect(c.outcome).toBe("broken");
    expect(c.detail.trigger_date).toBe(day(4));
    // Buying back 100 at 12 (day 5) vs the actual 8: holding on made $400.
    expect(c.detail.cost).toBe(-400);
    expect(c.detail.summary).toContain("Holding on made $400.00 more this time");
  });

  it("honours a longer grace period", () => {
    expect(checkMaExit(rule({ grace_days: 2 }), series, trade(), days(4, 9)).outcome).toBe("followed");
  });

  it("can't check a same-day trade or one without enough history", () => {
    expect(checkMaExit(rule(), series, trade({ exit_date: day(4) }), days(4, 4)).outcome).toBe("unevaluable");
    expect(checkMaExit(rule({ ma_period: 150 }), series, trade(), days(4, 9)).detail.summary).toContain(
      "Not enough price history",
    );
    expect(checkMaExit(rule(), series, trade({ direction: null }), days(4, 9)).outcome).toBe("unevaluable");
  });

  it("an open trade past its deadline is broken, with the cost so far", () => {
    const c = checkMaExit(rule(), series, trade({ status: "open", exit_date: null, exit_price: null }), days(4, null));
    expect(c.outcome).toBe("broken");
    expect(c.detail.still_open).toBe(true);
    expect(c.detail.days_late).toBe(2); // deadline day 8, last close day 10
    expect(c.detail.cost).toBe(100); // 8 at the deadline vs 7 now
  });

  it("an open trade still inside its grace period isn't judged yet", () => {
    const short = series.slice(0, 7); // last close is the trigger day
    const c = checkMaExit(rule(), short, trade({ status: "open", exit_date: null }), days(4, null));
    expect(c.outcome).toBe("unevaluable");
    expect(c.detail.summary).toContain("within 1 trading day");
  });
});

describe("costOfHolding with partial sells", () => {
  it("counts only the shares still held at the deadline", () => {
    const t = trade({
      exit_price: 7,
      partial_exits: [
        // Before the deadline: not part of the cost.
        { id: "a", date: "2026-10-05T15:00:00Z", shares: 40, price: 12, reason: "partial_profit" },
        // After: sold 20 at 7.5 instead of 8.
        { id: "b", date: "2026-10-09T15:00:00Z", shares: 20, price: 7.5, reason: "reduce_risk" },
      ],
    });
    // Held 60 at the deadline (8): follow = 480. Actual = 20 x 7.5 + 40 x 7 = 430.
    expect(costOfHolding(t, { day: day(8), close: 8 }, 7)).toBe(50);
  });
});

describe("moving-average entry", () => {
  const entry = rule({ kind: "ma_entry", entry_template: "price_above_ma" });

  it("judges the entry price against the average as of the day before", () => {
    // Day 6 entry: the day-5 SMA is 11. Entry at 11.5 is above -> followed.
    expect(checkMaEntry(entry, series, trade({ entry_price: 11.5 }), days(6, 9)).outcome).toBe("followed");
    const c = checkMaEntry(entry, series, trade({ entry_price: 10.5 }), days(6, 9));
    expect(c.outcome).toBe("broken");
    expect(c.detail.summary).toContain("below the SMA 3 (11 on Oct 5, 2026), against the rule for a long");
  });

  it("mirrors for a short", () => {
    expect(checkMaEntry(entry, series, trade({ direction: "short", entry_price: 10.5 }), days(6, 9)).outcome).toBe(
      "followed",
    );
  });

  it("compares two averages", () => {
    const cross = rule({ kind: "ma_entry", entry_template: "ma_above_ma", ma_period: 2, ma_type_2: "sma", ma_period_2: 4 });
    // Day 6 entry, as of day 5: SMA2 = 11.5, SMA4 = 10.75 -> above, a long follows it.
    expect(checkMaEntry(cross, series, trade(), days(6, 9)).outcome).toBe("followed");
    // As of day 9: SMA2 = 8, SMA4 = 9.25 -> below.
    expect(checkMaEntry(cross, series, trade(), days(10, 10)).outcome).toBe("broken");
  });

  it("can't check without enough history", () => {
    expect(checkMaEntry(entry, series, trade(), days(2, 9)).outcome).toBe("unevaluable");
  });
});

describe("exchange days", () => {
  it("reads a date typed with no time as that day on the exchange", () => {
    expect(tradeDay("2026-10-08", "America/New_York")).toBe("2026-10-08");
    expect(tradeDay("2026-10-08T00:00:00.000Z", "America/New_York")).toBe("2026-10-08");
    // 02:00 UTC is still the evening before in New York.
    expect(tradeDay("2026-10-08T02:00:00.000Z", "America/New_York")).toBe("2026-10-07");
  });

  it("dates daily bars by the exchange's calendar", () => {
    // 13:30 UTC = 09:30 New York, Oct 8.
    const bars = [{ time: Date.UTC(2026, 9, 8, 13, 30) / 1000, open: 1, high: 1, low: 1, close: 5 }];
    expect(toDailyCloses(bars, "America/New_York")).toEqual([{ day: "2026-10-08", close: 5 }]);
  });
});
