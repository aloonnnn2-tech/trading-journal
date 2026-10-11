import { describe, expect, it } from "vitest";
import { fillQuestion, outsideFillRange, type FillCheckTrade } from "./fill-check";

const base: FillCheckTrade = {
  status: "open",
  order_type: "stop_limit",
  direction: "long",
  entry_price: 25.7,
  limit_price: 25.7,
  fill_price_confirmed: false,
  order_price: 25.58,
};

describe("fillQuestion", () => {
  it("asks only when migration 0063 has marked the trade", () => {
    expect(fillQuestion({ ...base, fill_price_confirmed: undefined })).toBeNull(); // before 0063
    expect(fillQuestion({ ...base, fill_price_confirmed: null })).toBeNull();
    expect(fillQuestion({ ...base, fill_price_confirmed: true })).toBeNull();
    expect(fillQuestion(base)).not.toBeNull();
  });

  it("never asks about a pending order or a market order", () => {
    expect(fillQuestion({ ...base, status: "pending" })).toBeNull();
    expect(fillQuestion({ ...base, order_type: "market" })).toBeNull();
    expect(fillQuestion({ ...base, order_type: null })).toBeNull();
  });

  it("a buy stop-limit: between its stop and its limit, starting on the assumed price", () => {
    const q = fillQuestion(base)!;
    expect(q.heading).toBe("Your buy stop-limit order is open.");
    expect(q.hint).toBe("A buy stop-limit fills between the stop (25.58) and the limit (25.7).");
    expect(q.assumed).toBe(25.7);
    expect(q.range).toEqual({ min: 25.58, max: 25.7 });
  });

  it("a sell stop-limit names the limit first", () => {
    const q = fillQuestion({ ...base, direction: "short", order_price: 30, limit_price: 29.8, entry_price: 29.8 })!;
    expect(q.heading).toBe("Your sell stop-limit order is open.");
    expect(q.hint).toBe("A sell stop-limit fills between the limit (29.8) and the stop (30).");
  });

  it("limits fill at the limit or better; stops at the stop or past it", () => {
    expect(fillQuestion({ ...base, order_type: "limit", order_price: 100, entry_price: 100 })!.hint).toBe(
      "A buy limit fills at 100 or lower.",
    );
    expect(fillQuestion({ ...base, order_type: "limit", direction: "short", order_price: 100 })!.range).toEqual({ min: 100 });
    const stop = fillQuestion({ ...base, order_type: "stop", order_price: 50, entry_price: 50 })!;
    expect(stop.hint).toMatch(/^A buy stop fills at 50 or higher, and can slip/);
    expect(stop.range).toEqual({ min: 50 });
  });

  it("says a closed trade's order filled, and gives no range it can't know", () => {
    expect(fillQuestion({ ...base, status: "closed" })!.heading).toBe("Your buy stop-limit order filled.");
    const trail = fillQuestion({ ...base, order_type: "trailing_stop" })!;
    expect(trail.range).toEqual({});
    expect(trail.hint).toMatch(/only your broker's fill/);
    expect(fillQuestion({ ...base, direction: null })!.hint).toBeNull();
    expect(fillQuestion({ ...base, direction: null })!.heading).toBe("Your stop-limit order is open.");
  });
});

describe("outsideFillRange", () => {
  it("flags a price well outside the range, not one at its edge", () => {
    const range = { min: 25.58, max: 25.7 };
    expect(outsideFillRange(25.62, range)).toBe(false);
    expect(outsideFillRange(25.7, range)).toBe(false);
    expect(outsideFillRange(25.75, range)).toBe(false); // within half a percent
    expect(outsideFillRange(26.5, range)).toBe(true);
    expect(outsideFillRange(1, {})).toBe(false);
  });
});
