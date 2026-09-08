import { describe, it, expect } from "vitest";
import {
  decideAutoExecution,
  describeAutoExecution,
  hasLapsed,
  isWatchable,
  type AutoExecutableTrade,
} from "./auto-execute";

// Order types (migration 0039).
//
// **The bug these pin down.** Before order types existed, a pending order
// filled whenever the session merely BRACKETED its trigger price, from either
// side. That is wrong for every real order type: a buy limit sits below the
// market and fills when price comes down to it, while a buy stop sits above
// and fills when price breaks up through it. On a bracket rule both filled on
// either move, so a buy limit filled on a day price rallied away from it.

const NOW = new Date("2026-07-31T12:00:00Z");

function resting(over: Partial<AutoExecutableTrade> = {}): AutoExecutableTrade {
  return {
    mode: "trade",
    status: "pending",
    direction: "long",
    entry_price: 100,
    stop_loss: 95,
    take_profit: 110,
    entry_date: null,
    order_type: null,
    limit_price: null,
    time_in_force: "gtc",
    ...over,
  } as AutoExecutableTrade;
}

describe("limit orders", () => {
  it("a buy limit fills when price comes DOWN to it", () => {
    const d = decideAutoExecution(
      resting({ order_type: "limit", direction: "long" }),
      { dayLow: 98, dayHigh: 103 },
      NOW,
    );
    expect(d?.changes.status).toBe("open");
    expect(d?.price).toBe(100);
  });

  it("a buy limit does NOT fill when price only rose through it", () => {
    // The old bracket rule filled this. It is the reason order types exist.
    const d = decideAutoExecution(
      resting({ order_type: "limit", direction: "long" }),
      { dayLow: 101, dayHigh: 108 },
      NOW,
    );
    expect(d).toBeNull();
  });

  it("a sell limit fills when price comes UP to it", () => {
    const d = decideAutoExecution(
      resting({ order_type: "limit", direction: "short" }),
      { dayLow: 97, dayHigh: 102 },
      NOW,
    );
    expect(d?.price).toBe(100);
  });

  it("a sell limit does not fill on a day price stayed below it", () => {
    const d = decideAutoExecution(
      resting({ order_type: "limit", direction: "short" }),
      { dayLow: 90, dayHigh: 99 },
      NOW,
    );
    expect(d).toBeNull();
  });
});

describe("stop orders", () => {
  it("a buy stop fills when price breaks UP through it", () => {
    const d = decideAutoExecution(
      resting({ order_type: "stop", direction: "long" }),
      { dayLow: 96, dayHigh: 104 },
      NOW,
    );
    expect(d?.price).toBe(100);
  });

  it("a buy stop does NOT fill when price only fell through it", () => {
    const d = decideAutoExecution(
      resting({ order_type: "stop", direction: "long" }),
      { dayLow: 90, dayHigh: 99 },
      NOW,
    );
    expect(d).toBeNull();
  });

  it("a sell stop fills when price breaks DOWN through it", () => {
    const d = decideAutoExecution(
      resting({ order_type: "stop", direction: "short" }),
      { dayLow: 96, dayHigh: 104 },
      NOW,
    );
    expect(d?.price).toBe(100);
  });
});

describe("stop-limit orders", () => {
  const buy = { order_type: "stop_limit" as const, direction: "long" as const, limit_price: 102 };

  it("fills at the LIMIT price, not at the stop price", () => {
    // The stop only triggers the order. The fill happens at the limit.
    const d = decideAutoExecution(resting(buy), { dayLow: 99, dayHigh: 105 }, NOW);
    expect(d?.price).toBe(102);
  });

  it("does not fill when the stop was never touched", () => {
    const d = decideAutoExecution(resting(buy), { dayLow: 95, dayHigh: 99 }, NOW);
    expect(d).toBeNull();
  });

  it("does not fill when the stop triggered but price never reached the limit", () => {
    // Price gapped straight past the limit and left the order unfilled, which
    // is the whole risk of using a stop-limit rather than a stop.
    const d = decideAutoExecution(
      resting({ ...buy, limit_price: 100.5 }),
      { dayLow: 100.8, dayHigh: 106 },
      NOW,
    );
    expect(d).toBeNull();
  });

  it("is not watched at all without its limit leg", () => {
    expect(isWatchable(resting({ order_type: "stop_limit", limit_price: null }))).toBe(false);
  });
});

describe("types the app refuses to fill on its own", () => {
  it("never fills a trailing stop, however far price moved", () => {
    // A trail depends on the path price took, and a daily high/low contains
    // no path. Recordable, never inferred.
    const d = decideAutoExecution(
      resting({ order_type: "trailing_stop" }),
      { dayLow: 50, dayHigh: 200 },
      NOW,
    );
    expect(d).toBeNull();
    expect(isWatchable(resting({ order_type: "trailing_stop" }))).toBe(false);
  });

  it("never fills a custom order type", () => {
    // The user named it themselves, so the app has no idea what its rules are.
    const d = decideAutoExecution(
      resting({ order_type: "other" }),
      { dayLow: 50, dayHigh: 200 },
      NOW,
    );
    expect(d).toBeNull();
  });

  it("never fills a market order left sitting in pending", () => {
    const d = decideAutoExecution(
      resting({ order_type: "market" }),
      { dayLow: 99, dayHigh: 101 },
      NOW,
    );
    expect(d).toBeNull();
    expect(isWatchable(resting({ order_type: "market" }))).toBe(false);
  });
});

describe("orders written before order types existed", () => {
  it("still fills on a bracket, exactly as it did before", () => {
    // Load-bearing: some of these are live resting orders. Applying migration
    // 0039 must not change how an order somebody is waiting on behaves.
    const d = decideAutoExecution(resting({ order_type: null }), { dayLow: 99, dayHigh: 101 }, NOW);
    expect(d?.price).toBe(100);
    expect(isWatchable(resting({ order_type: null }))).toBe(true);
  });
});

describe("the fill message names the order type", () => {
  it("says which kind of order fired", () => {
    const limit = decideAutoExecution(
      resting({ order_type: "limit", direction: "long" }),
      { dayLow: 98, dayHigh: 103 },
      NOW,
    );
    expect(describeAutoExecution(limit!)).toContain("Limit order filled");

    const stop = decideAutoExecution(
      resting({ order_type: "stop", direction: "long" }),
      { dayLow: 96, dayHigh: 104 },
      NOW,
    );
    expect(describeAutoExecution(stop!)).toContain("Stop order triggered");
  });

  it("falls back to the generic wording when the type is unknown", () => {
    const d = decideAutoExecution(resting({ order_type: null }), { dayLow: 99, dayHigh: 101 }, NOW);
    expect(describeAutoExecution(d!)).toContain("Entry hit");
  });
});

describe("day orders expiring", () => {
  const placed = "2026-07-30T18:00:00Z";
  const day = { status: "pending" as const, time_in_force: "day" as const, created_at: placed };

  it("survives the whole of the day it was placed", () => {
    expect(hasLapsed(day, new Date("2026-07-30T23:30:00Z"), "UTC")).toBe(false);
  });

  it("lapses once that day is over", () => {
    expect(hasLapsed(day, new Date("2026-07-31T00:30:00Z"), "UTC")).toBe(true);
  });

  it("uses the trader's own timezone rather than UTC", () => {
    // 18:00 UTC on the 30th is 14:00 that same day in New York, so at 03:00
    // UTC on the 31st it is still 23:00 on the 30th there and the order lives.
    expect(hasLapsed(day, new Date("2026-07-31T03:00:00Z"), "America/New_York")).toBe(false);
    expect(hasLapsed(day, new Date("2026-07-31T05:00:00Z"), "America/New_York")).toBe(true);
  });

  it("never lapses a good-til-cancelled order", () => {
    expect(
      hasLapsed({ ...day, time_in_force: "gtc" }, new Date("2027-01-01T00:00:00Z"), "UTC"),
    ).toBe(false);
  });

  it("never lapses an order that already filled", () => {
    expect(hasLapsed({ ...day, status: "open" }, new Date("2027-01-01T00:00:00Z"), "UTC")).toBe(
      false,
    );
  });
});
