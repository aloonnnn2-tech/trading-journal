import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/market-data/yahoo";
import {
  buildRegimeSeries,
  isBenchmarkRelevant,
  regimeOn,
  VOL_WINDOW,
} from "./classify";

// The carry-back is the test that matters most: without it, 12 of 50 trades in
// the journal this was built against matched no bar at all, because they closed
// on a weekend or holiday. A quarter of a journal silently vanishing from an
// analysis is worse than the analysis not existing.

/** A benchmark series of `n` sessions, `move` being the daily move as a
 *  fraction. Dates advance by one day, which is enough for these tests. */
function series(n: number, move: (i: number) => number = () => 0.001, startDay = 1): Candle[] {
  const candles: Candle[] = [];
  let close = 100;
  for (let i = 0; i < n; i++) {
    close = close * (1 + move(i));
    const date = new Date(Date.UTC(2026, 0, startDay + i));
    candles.push({
      time: date.toISOString().slice(0, 10),
      open: close,
      high: close,
      low: close,
      close,
    });
  }
  return candles;
}

describe("buildRegimeSeries", () => {
  it("returns null when there is not enough history to measure", () => {
    expect(buildRegimeSeries(series(VOL_WINDOW))).toBeNull();
    expect(buildRegimeSeries([])).toBeNull();
  });

  it("classifies every day it has a full window for", () => {
    const candles = series(100, () => 0.001);
    const result = buildRegimeSeries(candles)!;
    expect(result.days).toBe(100 - VOL_WINDOW);
  });

  it("splits at the median of the whole series, not an absolute threshold", () => {
    // Calm for the first half, choppy for the second. The split has to land
    // between them rather than at some fixed percentage that would be wrong
    // for a different asset or decade.
    const candles = series(200, (i) => (i < 100 ? 0.0005 : (i % 2 === 0 ? 0.03 : -0.03)));
    const result = buildRegimeSeries(candles)!;

    const bands = [...result.byDay.values()];
    expect(bands.some((b) => b.band === "high")).toBe(true);
    expect(bands.some((b) => b.band === "low")).toBe(true);
    expect(result.medianVolatility).toBeGreaterThan(0);
  });

  it("annualises the volatility", () => {
    // A steady 1% daily oscillation is roughly 1% * sqrt(252) annualised,
    // which is far above 1 -- the point being that the figure is annualised
    // rather than a raw daily standard deviation.
    const candles = series(80, (i) => (i % 2 === 0 ? 0.01 : -0.01));
    const result = buildRegimeSeries(candles)!;
    const vol = [...result.byDay.values()][result.days - 1].volatility;

    expect(vol).toBeGreaterThan(0.1);
  });

  it("never labels more than half the days high, because the split is a median", () => {
    // The invariant that makes "high volatility" mean something: it is
    // relative to this benchmark's own history, so at most half of it can
    // qualify. An absolute threshold could call every day high, which would
    // describe nothing.
    for (const move of [
      (i: number) => (i % 2 === 0 ? 0.01 : -0.01), // uniform
      (i: number) => (i < 100 ? 0.0005 : i % 2 === 0 ? 0.03 : -0.03), // calm then choppy
      (i: number) => Math.sin(i) * 0.02, // varying
    ]) {
      const result = buildRegimeSeries(series(200, move))!;
      const high = [...result.byDay.values()].filter((b) => b.band === "high").length;
      expect(high).toBeLessThanOrEqual(Math.ceil(result.days / 2));
    }
  });

  it("survives a zero close without producing a non-finite volatility", () => {
    const candles = series(60, () => 0.001);
    candles[30] = { ...candles[30], close: 0 };
    const result = buildRegimeSeries(candles)!;
    expect([...result.byDay.values()].every((b) => Number.isFinite(b.volatility))).toBe(true);
  });
});

describe("regimeOn", () => {
  const candles = series(60, () => 0.001);
  const result = buildRegimeSeries(candles)!;
  const tradingDays = [...result.byDay.keys()];

  it("returns the regime for a trading day directly", () => {
    expect(regimeOn(result, tradingDays[5])).not.toBeNull();
  });

  it("carries back to the previous session for a non-trading day", () => {
    // A trade closed on a Saturday has no bar of its own. The regime in force
    // is the one from the last session, not nothing.
    const lastDay = tradingDays[tradingDays.length - 1];
    const nextDay = new Date(new Date(`${lastDay}T00:00:00Z`).getTime() + 86_400_000)
      .toISOString()
      .slice(0, 10);

    expect(regimeOn(result, nextDay)).toEqual(result.byDay.get(lastDay));
  });

  it("carries back across a long weekend", () => {
    const lastDay = tradingDays[tradingDays.length - 1];
    const threeDaysLater = new Date(new Date(`${lastDay}T00:00:00Z`).getTime() + 3 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    expect(regimeOn(result, threeDaysLater)).toEqual(result.byDay.get(lastDay));
  });

  it("gives up rather than attaching a trade to a distant bar", () => {
    // A trade outside the benchmark's history must be reported as unmatched,
    // not silently attributed to whatever bar happens to be nearest.
    const lastDay = tradingDays[tradingDays.length - 1];
    const muchLater = new Date(new Date(`${lastDay}T00:00:00Z`).getTime() + 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    expect(regimeOn(result, muchLater)).toBeNull();
  });

  it("returns null for a date before the series begins", () => {
    expect(regimeOn(result, "2020-01-01")).toBeNull();
  });

  it("returns null for a malformed date rather than throwing", () => {
    expect(regimeOn(result, "not-a-date")).toBeNull();
  });
});

describe("isBenchmarkRelevant", () => {
  it("excludes assets an equity benchmark does not describe", () => {
    // A crypto position filed under "S&P volatility" is a category error, not
    // an approximation.
    expect(isBenchmarkRelevant("Crypto")).toBe(false);
    expect(isBenchmarkRelevant("crypto")).toBe(false);
    expect(isBenchmarkRelevant("Forex")).toBe(false);
    expect(isBenchmarkRelevant("FX pair")).toBe(false);
  });

  it("keeps equities and untyped trades", () => {
    // Untyped trades are equities in practice; excluding them would throw
    // away more signal than the occasional mislabel costs.
    expect(isBenchmarkRelevant("Stock")).toBe(true);
    expect(isBenchmarkRelevant(null)).toBe(true);
    expect(isBenchmarkRelevant("")).toBe(true);
  });
});
