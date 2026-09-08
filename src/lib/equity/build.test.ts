import { describe, expect, it } from "vitest";
import { buildEquityCurve, type EquityEvent } from "./build";

// The property that matters most: a WITHDRAWAL IS NOT A DRAWDOWN. Paying
// yourself drops the balance, and a drawdown measured on the balance would
// report that as a losing streak -- a confident, wrong claim about the
// trader's discipline.

const trade = (at: string, pl: number, r: number | null = null): EquityEvent => ({ at, pl, r });
const cash = (at: string, amount: number): EquityEvent => ({ at, cash: amount });

describe("buildEquityCurve — separating funding from performance", () => {
  it("keeps trading profit and deposits apart", () => {
    const curve = buildEquityCurve([
      cash("2026-01-01T00:00:00Z", 45000),
      trade("2026-01-05T00:00:00Z", 500, 1),
      cash("2026-02-01T00:00:00Z", 10000),
      trade("2026-02-05T00:00:00Z", 300, 0.5),
    ]);

    expect(curve.finalPL).toBe(800);
    expect(curve.netDeposits).toBe(55000);
    // The balance is both; the performance is only the first.
    expect(curve.finalEquity).toBe(55800);
    expect(curve.finalR).toBeCloseTo(1.5);
  });

  it("leaves cumulative R untouched by account size", () => {
    // The whole point: the same trades on a $45k and a $450k account produce
    // the same R, and R is what says whether the trading works.
    const small = buildEquityCurve([cash("2026-01-01T00:00:00Z", 45000), trade("2026-01-05T00:00:00Z", 500, 1)]);
    const large = buildEquityCurve([cash("2026-01-01T00:00:00Z", 450000), trade("2026-01-05T00:00:00Z", 500, 1)]);

    expect(small.finalR).toBe(large.finalR);
    expect(small.finalEquity).not.toBe(large.finalEquity);
  });

  it("sorts events from both sources into one series", () => {
    // Trades and cash movements come from separate queries; neither knows
    // about the other's ordering.
    const curve = buildEquityCurve([
      trade("2026-03-01T00:00:00Z", 100),
      cash("2026-01-01T00:00:00Z", 1000),
      trade("2026-02-01T00:00:00Z", 50),
    ]);

    expect(curve.points.map((p) => p.date)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    expect(curve.points[0].accountEquity).toBe(1000);
  });
});

describe("buildEquityCurve — a withdrawal is not a drawdown", () => {
  it("does not register a withdrawal as a losing run", () => {
    const curve = buildEquityCurve([
      cash("2026-01-01T00:00:00Z", 10000),
      trade("2026-01-05T00:00:00Z", 1000, 2),
      cash("2026-01-10T00:00:00Z", -5000), // paid yourself
    ]);

    // The balance halved, but the trading never gave anything back.
    expect(curve.finalEquity).toBe(6000);
    expect(curve.maxDrawdown).toBe(0);
  });

  it("does not let a deposit heal a real drawdown", () => {
    const curve = buildEquityCurve([
      cash("2026-01-01T00:00:00Z", 10000),
      trade("2026-01-05T00:00:00Z", 1000),
      trade("2026-01-06T00:00:00Z", -400),
      cash("2026-01-07T00:00:00Z", 50000), // a big deposit
    ]);

    // Still 400 down from the trading peak, however much was added.
    expect(curve.points[curve.points.length - 1].drawdown).toBeCloseTo(-400);
  });

  it("measures drawdown from the trading peak", () => {
    const curve = buildEquityCurve([
      trade("2026-01-01T00:00:00Z", 1000),
      trade("2026-01-02T00:00:00Z", -600),
      trade("2026-01-03T00:00:00Z", 200),
      trade("2026-01-04T00:00:00Z", -300),
    ]);
    // Peak 1000, trough 300 -> -700.
    expect(curve.maxDrawdown).toBeCloseTo(-700);
  });
});

describe("buildEquityCurve — percentage drawdown", () => {
  it("takes the percentage against the account at the peak", () => {
    // A $1,000 fall is 10% of a $10,000 account, not of whatever the balance
    // happens to be after later funding.
    const curve = buildEquityCurve([
      cash("2026-01-01T00:00:00Z", 10000),
      trade("2026-01-05T00:00:00Z", 0),
      trade("2026-01-06T00:00:00Z", -1000),
    ]);

    expect(curve.maxDrawdown).toBeCloseTo(-1000);
    expect(curve.maxDrawdownPercent).toBeCloseTo(-0.1);
  });

  it("is null rather than zero when no capital was recorded", () => {
    // A percentage of nothing is undefined, not 0% -- and a chart showing 0%
    // would imply a measured result.
    const curve = buildEquityCurve([trade("2026-01-05T00:00:00Z", -500)]);
    expect(curve.points[0].drawdownPercent).toBeNull();
  });

  it("uses the account at the peak, not the account today", () => {
    const curve = buildEquityCurve([
      cash("2026-01-01T00:00:00Z", 10000),
      trade("2026-01-05T00:00:00Z", 1000), // peak, account 11000
      trade("2026-01-06T00:00:00Z", -1100),
      cash("2026-01-07T00:00:00Z", 100000), // later funding must not dilute it
    ]);
    expect(curve.maxDrawdownPercent).toBeCloseTo(-0.1);
  });
});

describe("buildEquityCurve — coverage", () => {
  it("counts how many trades carried an R multiple", () => {
    // The R line and the P&L line do not rest on the same trades, and the UI
    // has to be able to say so rather than implying they do.
    const curve = buildEquityCurve([
      trade("2026-01-01T00:00:00Z", 100, 1),
      trade("2026-01-02T00:00:00Z", 100, null),
      trade("2026-01-03T00:00:00Z", 100, 2),
    ]);

    expect(curve.trades).toBe(3);
    expect(curve.tradesWithR).toBe(2);
    expect(curve.finalR).toBeCloseTo(3);
  });

  it("does not count cash movements as trades", () => {
    const curve = buildEquityCurve([cash("2026-01-01T00:00:00Z", 5000), trade("2026-01-02T00:00:00Z", 10)]);
    expect(curve.trades).toBe(1);
  });

  it("handles an empty journal without dividing by anything", () => {
    const curve = buildEquityCurve([]);
    expect(curve).toMatchObject({ points: [], finalPL: 0, finalR: 0, maxDrawdown: 0 });
    expect(curve.maxDrawdownPercent).toBeNull();
  });
});
