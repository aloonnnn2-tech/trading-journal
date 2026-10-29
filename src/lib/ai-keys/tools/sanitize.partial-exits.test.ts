import { describe, expect, it } from "vitest";
import { compactRow, compactTradeDetail } from "./sanitize";
import type { Row } from "./filter";

// Ask sees partial sells (0079): get_trade lists each one, worked out, and
// query_trades rows say a trade was closed in pieces.

const row = (over: Partial<Row> = {}): Row =>
  ({
    id: "t1",
    mode: "trade",
    status: "closed",
    result: "win",
    ticker: "NVDA",
    direction: "long",
    entry_price: 50,
    exit_price: 55,
    shares: 100,
    dollar_pl: 700,
    custom_fields: {},
    strategy_field_values: {},
    partial_exits: [{ id: "s1", date: "2026-10-20T15:00:00Z", shares: 40, price: 60, reason: "partial_profit" }],
    ...over,
  }) as Row;

const fields = { trade: [], investment: [], byStrategy: {} };

describe("Ask and partial sells", () => {
  it("get_trade lists each sale with its P&L, reason and the shares left", () => {
    const out = compactTradeDetail(row(), fields, []);
    expect(out.partial_sells).toEqual([
      "Partial sells: 1, 40 of 100 shares, realized +$400.00 before fees, average sale price 60",
      "1. 2026-10-20: sold 40 at 60; P&L +$400.00 before fees; reason: Took partial profit; 60 left after it",
      "The remaining 60 shares were closed at 55 (the exit price).",
    ]);
    // The raw column never goes out.
    expect(out).not.toHaveProperty("partial_exits");
  });

  it("a list row says how many sales there were", () => {
    expect(compactRow(row()).partial_sells).toBe(1);
  });

  it("adds nothing for a trade without sales, or from before 0079", () => {
    expect(compactTradeDetail(row({ partial_exits: [] }), fields, [])).not.toHaveProperty("partial_sells");
    expect(compactRow(row({ partial_exits: undefined }))).not.toHaveProperty("partial_sells");
  });
});
