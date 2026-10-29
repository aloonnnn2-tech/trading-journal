import { describe, expect, it, vi, afterEach } from "vitest";
import { computeDerivedFields } from "./compute";
import {
  describePartialExits,
  partialExitInputSchema,
  partialExitsProblem,
  readPartialExits,
  summarizePartialExits,
} from "./partial-exits";
import type { PartialExit, Trade, TradeCoreFields } from "./types";

function sale(over: Partial<PartialExit> = {}): PartialExit {
  return { id: "s1", date: "2026-10-20T15:00:00.000Z", shares: 40, price: 60, reason: "earnings", ...over };
}

function core(over: Partial<TradeCoreFields> = {}): TradeCoreFields {
  return {
    entry_price: 50,
    exit_price: 55,
    stop_loss: 45,
    take_profit: 70,
    shares: 100,
    risk_amount: 500,
    direction: "long",
    commission: null,
    ...over,
  };
}

function trade(over: Partial<Trade> = {}): Trade {
  return {
    id: "t1",
    user_id: "u1",
    mode: "trade",
    ticker: "NVDA",
    company_name: null,
    asset_type: null,
    market: null,
    direction: "long",
    status: "open",
    result: "open",
    order_type: null,
    order_type_other: null,
    limit_price: null,
    time_in_force: "gtc",
    entry_price: 50,
    exit_price: null,
    stop_loss: 45,
    take_profit: 70,
    shares: 100,
    position_size: 5000,
    dollar_amount: null,
    risk_amount: 500,
    risk_percent: null,
    entry_date: "2026-10-15T14:30:00.000Z",
    exit_date: null,
    commission: null,
    commission_manual: false,
    dollar_pl: null,
    percent_return: null,
    r_multiple: null,
    risk_reward_ratio: null,
    custom_fields: {},
    strategy_field_values: {},
    partial_exits: [],
    created_at: "2026-10-15T14:30:00.000Z",
    updated_at: "2026-10-15T14:30:00.000Z",
    ...over,
  };
}

afterEach(() => vi.useRealTimers());

describe("P&L with partial sells", () => {
  it("adds each sale to the rest at the exit price (the worked example)", () => {
    // 100 at 50; 40 sold at 60 (+400); the other 60 at 55 (+300).
    const d = computeDerivedFields(core({ partial_exits: [sale()] }));
    expect(d.dollar_pl).toBe(700);
    expect(d.percent_return).toBeCloseTo(14); // 700 / 5,000
    expect(d.r_multiple).toBeCloseTo(1.4); // 700 / 500 risked
  });

  it("is exactly the old formula with no sales", () => {
    expect(computeDerivedFields(core()).dollar_pl).toBe(500);
    expect(computeDerivedFields(core({ partial_exits: [] })).dollar_pl).toBe(500);
    expect(computeDerivedFields(core({ partial_exits: undefined })).dollar_pl).toBe(500);
  });

  it("works for a short: buying back lower is profit", () => {
    // Short 100 at 50; 40 covered at 45 (+200); 60 covered at 48 (+120).
    const d = computeDerivedFields(
      core({ direction: "short", exit_price: 48, partial_exits: [sale({ price: 45 })] }),
    );
    expect(d.dollar_pl).toBe(320);
  });

  it("counts a losing sale as a loss", () => {
    // 30 sold at 47 (-90) to cut risk; 70 out at 55 (+350).
    const d = computeDerivedFields(core({ partial_exits: [sale({ shares: 30, price: 47 })] }));
    expect(d.dollar_pl).toBe(260);
  });

  it("subtracts the stored commission, which includes the sales' fees", () => {
    expect(computeDerivedFields(core({ commission: 10, partial_exits: [sale()] })).dollar_pl).toBe(690);
  });

  it("leaves an open trade's P&L empty: the rest hasn't been sold", () => {
    expect(computeDerivedFields(core({ exit_price: null, partial_exits: [sale()] })).dollar_pl).toBeNull();
  });

  it("ignores a malformed stored value instead of failing", () => {
    const d = computeDerivedFields(core({ partial_exits: [{ shares: "x" }, null, 5] as unknown as PartialExit[] }));
    expect(d.dollar_pl).toBe(500);
  });
});

describe("readPartialExits", () => {
  it("returns well-formed sales oldest first", () => {
    const sales = readPartialExits([
      sale({ id: "b", date: "2026-10-21T15:00:00.000Z" }),
      { nope: true },
      sale({ id: "a", date: "2026-10-18T15:00:00.000Z" }),
    ]);
    expect(sales.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("treats a missing column or null as no sales", () => {
    expect(readPartialExits(undefined)).toEqual([]);
    expect(readPartialExits(null)).toEqual([]);
    expect(readPartialExits("[]")).toEqual([]);
  });
});

describe("the sale form's schema", () => {
  const ok = { date: "2026-10-20T15:00:00Z", shares: 10, price: 12.5, reason: "reduce_risk" };
  it("accepts a sale", () => {
    expect(partialExitInputSchema.safeParse(ok).success).toBe(true);
  });
  it.each([
    ["zero shares", { shares: 0 }],
    ["negative price", { price: -1 }],
    ["an unknown reason", { reason: "vibes" }],
    ["a bad date", { date: "soon" }],
    ["a negative fee", { fee: -2 }],
    ["a control character in the note", { note: "a\u0000b" }],
    ["a note over 500 characters", { note: "x".repeat(501) }],
    ["an extra key", { id: "mine" }],
  ])("refuses %s", (_label, over) => {
    expect(partialExitInputSchema.safeParse({ ...ok, ...over }).success).toBe(false);
  });
});

describe("partialExitsProblem", () => {
  it("allows sales of part of an open position", () => {
    expect(partialExitsProblem(trade(), [sale()])).toBeNull();
  });

  it("refuses selling everything: that's closing the trade", () => {
    expect(partialExitsProblem(trade(), [sale({ shares: 100 })])).toMatch(/close the trade/);
    expect(partialExitsProblem(trade(), [sale({ shares: 60 }), sale({ id: "s2", shares: 40 })])).toMatch(
      /close the trade/,
    );
  });

  it("refuses selling more than held", () => {
    expect(partialExitsProblem(trade(), [sale({ shares: 150 })])).not.toBeNull();
  });

  it("needs an open or closed trade with an entry and shares", () => {
    expect(partialExitsProblem(trade({ status: "pending" }), [sale()])).toMatch(/once it's open/);
    expect(partialExitsProblem(trade({ entry_price: null }), [sale()])).toMatch(/entry price/);
    expect(partialExitsProblem(trade({ shares: null }), [sale()])).toMatch(/number of shares/);
    expect(partialExitsProblem(trade({ mode: "investment" }), [sale()])).not.toBeNull();
  });

  it("keeps sales between the entry and the exit", () => {
    expect(partialExitsProblem(trade(), [sale({ date: "2026-10-10T15:00:00Z" })])).toMatch(/before/);
    expect(
      partialExitsProblem(trade({ status: "closed", exit_date: "2026-10-19T15:00:00Z" }), [sale()]),
    ).toMatch(/after the trade's exit/);
  });

  it("refuses a sale dated in the future", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    expect(partialExitsProblem(trade(), [sale({ date: "2026-10-25T12:00:00Z" })])).toMatch(/future/);
  });

  it("says nothing with no sales", () => {
    expect(partialExitsProblem(trade({ status: "pending", shares: null }), [])).toBeNull();
  });
});

describe("summary and the AI's description", () => {
  it("adds up what was sold and what's left", () => {
    const s = summarizePartialExits(
      trade({ partial_exits: [sale(), sale({ id: "s2", shares: 20, price: 65, date: "2026-10-21T15:00:00Z" })] }),
    );
    expect(s.soldShares).toBe(60);
    expect(s.remainingShares).toBe(40);
    expect(s.realizedGross).toBe(400 + 300);
    expect(s.averageSalePrice).toBeCloseTo((40 * 60 + 20 * 65) / 60);
  });

  it("keeps fractional shares exact", () => {
    const s = summarizePartialExits(trade({ shares: 0.3, partial_exits: [sale({ shares: 0.1 }), sale({ id: "b", shares: 0.1 })] }));
    expect(s.remainingShares).toBe(0.1);
  });

  it("describes every sale with its P&L, reason, note and the shares left", () => {
    const lines = describePartialExits(
      trade({
        status: "closed",
        exit_price: 55,
        exit_date: "2026-10-25T15:00:00Z",
        partial_exits: [sale({ note: "earnings  Thursday\nafter close" })],
      }),
    );
    expect(lines[0]).toBe("Partial sells: 1, 40 of 100 shares, realized +$400.00 before fees, average sale price 60");
    expect(lines[1]).toBe(
      '1. 2026-10-20: sold 40 at 60; P&L +$400.00 before fees; reason: Earnings coming up; note: "earnings Thursday after close"; 60 left after it',
    );
    expect(lines[2]).toBe("The remaining 60 shares were closed at 55 (the exit price).");
  });

  it("says 'bought back' for a short and 'still holding' while open", () => {
    const lines = describePartialExits(trade({ direction: "short", partial_exits: [sale({ price: 45 })] }));
    expect(lines[1]).toContain("bought back 40 at 45; P&L +$200.00");
    expect(lines.at(-1)).toBe("Still holding 60 shares.");
  });

  it("is empty with no sales", () => {
    expect(describePartialExits(trade())).toEqual([]);
  });
});
