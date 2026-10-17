import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limits/daily", () => ({ takeYahooSlot: async () => true }));
vi.mock("@/lib/market-data/yahoo", () => ({
  fetchYahooCandles: async (symbol: string) =>
    symbol === "NOPE"
      ? null
      : symbol === "LONG"
        ? {
            candles: Array.from({ length: 250 }, (_, i) => ({
              time: `2026-01-01T00:00:${String(i).padStart(3, "0")}`,
              open: 100.25 + i,
              high: 101.75 + i,
              low: 99.5 + i,
              close: 100.5 + i,
              volume: 12_345_678,
            })),
            currentPrice: 350,
            dayHigh: 351,
            dayLow: 349,
            quoteTime: new Date("2026-10-15T20:00:00Z"),
          }
        : {
          candles: [
            { time: "2026-10-01", open: 100, high: 105, low: 99, close: 100 },
            { time: "2026-10-15", open: 108, high: 112, low: 107, close: 110 },
          ],
          currentPrice: 110.5,
          dayHigh: 112,
          dayLow: 107,
          quoteTime: new Date("2026-10-15T20:00:00Z"),
        },
}));

import { calculate, evaluateExpression, getMarketData, sampleBars } from "./general";

describe("evaluateExpression", () => {
  it("does arithmetic with the usual precedence", () => {
    expect(evaluateExpression("2 + 3 * 4")).toBe(14);
    expect(evaluateExpression("(2 + 3) * 4")).toBe(20);
    expect(evaluateExpression("2 ^ 3 ^ 2")).toBe(512);
    expect(evaluateExpression("-3 + 10 % 4")).toBe(-1);
  });

  it("sizes a position exactly: risk $200 on a 95 -> 92.5 stop", () => {
    expect(evaluateExpression("floor(200 / (95 - 92.5))")).toBe(80);
    expect(evaluateExpression("round(1234.5678, 2)")).toBe(1234.57);
    expect(evaluateExpression("max(1, 7, 3) + sqrt(16)")).toBe(11);
  });

  it("is never eval: anything but arithmetic is refused", () => {
    for (const bad of ["process.exit()", "alert(1)", "constructor", "1; 2", "a = 1", "[1]", "`x`"]) {
      expect(() => evaluateExpression(bad), bad).toThrow();
    }
  });

  it("reports division by zero instead of returning Infinity", () => {
    expect(calculate({ expression: "1 / 0" })).toEqual({ expression: "1 / 0", error: expect.stringMatching(/finite/) });
  });
});

describe("sampleBars", () => {
  it("keeps short histories whole and always keeps the last bar", () => {
    expect(sampleBars([1, 2, 3], 5)).toEqual([1, 2, 3]);
    const sampled = sampleBars(Array.from({ length: 250 }, (_, i) => i), 120);
    expect(sampled.length).toBeLessThanOrEqual(121);
    expect(sampled.at(-1)).toBe(249);
  });
});

describe("getMarketData", () => {
  it("returns the quote with its time, and the change over the range", async () => {
    const out = (await getMarketData({ symbol: "aapl", range: "1mo" })) as {
      symbol: string;
      quote: { price: number; as_of: string };
      range: { change_pct: number; high: number; low: number };
    };
    expect(out.symbol).toBe("AAPL");
    expect(out.quote.price).toBe(110.5);
    expect(out.quote.as_of).toBe("2026-10-15T20:00:00.000Z");
    expect(out.range).toMatchObject({ change_pct: 10, high: 112, low: 99 });
  });

  it("thins the bars to fit a free tier's output budget, keeping the quote and the last bar", async () => {
    const out = (await getMarketData({ symbol: "LONG", range: "1y" }, 6_000)) as {
      quote: { price: number };
      daily_bars: { close: number }[];
      bars_sampled: boolean;
    };
    expect(JSON.stringify(out).length).toBeLessThan(6_000);
    expect(out.quote.price).toBe(350);
    expect(out.daily_bars.at(-1)?.close).toBe(349.5);
    expect(out.bars_sampled).toBe(true);
  });

  it("says so for an unknown or malformed symbol", async () => {
    expect(await getMarketData({ symbol: "NOPE" })).toHaveProperty("error");
    expect(await getMarketData({ symbol: "a b;c" })).toHaveProperty("error");
  });
});
