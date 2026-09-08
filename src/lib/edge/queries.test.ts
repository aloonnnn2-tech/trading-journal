import { describe, expect, it } from "vitest";
import { buildSegments } from "@/lib/segments/engine";
import { edgeDimensions, type EdgeRow } from "./queries";

// The engine's arithmetic is tested in lib/segments. What is tested here is
// the part unique to this feature: that each dimension cuts the journal the
// way a trader would expect, and that a drill-down link goes to exactly the
// segment's own trades -- a link showing *almost* the right trades would
// quietly undermine every number next to it.

const NY = "America/New_York";

function row(over: Partial<EdgeRow> = {}): EdgeRow {
  return {
    id: `t-${Math.random()}`,
    ticker: "NVDA",
    direction: "long",
    market: "US",
    asset_type: "stock",
    entry_date: "2026-08-10T13:30:00Z",
    exit_date: "2026-08-14T19:00:00Z",
    dollar_pl: 100,
    r_multiple: 1,
    risk_percent: 0.8,
    take_profit: 120,
    exit_price: 110,
    emotion_before: ["calm"],
    trade_strategies: [{ strategies: [{ id: "s-1", name: "Breakout" }] }],
    ...over,
  };
}

function dimension(id: string) {
  return edgeDimensions(NY).find((d) => d.id === id)!;
}

function segmentsFor(id: string, rows: EdgeRow[]) {
  return buildSegments(rows, dimension(id));
}

describe("edge dimensions — cuts", () => {
  it("cuts by strategy name", () => {
    const segments = segmentsFor("strategy", [
      row(),
      row({ trade_strategies: [{ strategies: [{ id: "s-2", name: "Reversal" }] }] }),
    ]);
    expect(segments.map((s) => s.value).sort()).toEqual(["Breakout", "Reversal"]);
  });

  it("buckets holding period, and skips a trade with no exit", () => {
    const segments = segmentsFor("holding", [
      row({ entry_date: "2026-08-10T13:30:00Z", exit_date: "2026-08-10T19:00:00Z" }), // intraday
      row({ entry_date: "2026-08-10T13:30:00Z", exit_date: "2026-08-14T19:00:00Z" }), // 4 days
      row({ entry_date: null }),
    ]);
    const values = segments.map((s) => s.value);
    expect(values).toContain("Intraday");
    expect(values).toContain("3–7 days");
    // The undated trade produced no segment rather than a phantom bucket.
    expect(segments.reduce((n, s) => n + s.stats.trades, 0)).toBe(2);
  });

  it("buckets risk, and skips trades with no risk recorded", () => {
    const segments = segmentsFor("risk", [
      row({ risk_percent: 0.3 }),
      row({ risk_percent: 0.8 }),
      row({ risk_percent: 1.5 }),
      row({ risk_percent: 4 }),
      row({ risk_percent: null }),
    ]);
    expect(segments.map((s) => s.value).sort()).toEqual([
      "0.5–1%",
      "1–2%",
      "2% or more",
      "Under 0.5%",
    ]);
  });

  it("classifies exit behaviour on winners only, direction-aware", () => {
    const segments = segmentsFor("exit", [
      // Long winner closed below target -> early.
      row({ dollar_pl: 100, exit_price: 110, take_profit: 120 }),
      // Long winner that reached target.
      row({ dollar_pl: 100, exit_price: 125, take_profit: 120 }),
      // Short winner closed ABOVE target -> early (target sits below entry).
      row({ direction: "short", dollar_pl: 100, exit_price: 105, take_profit: 100 }),
      // A loser is excluded: exiting short of target on a loser is the stop
      // being hit, not an exit decision.
      row({ dollar_pl: -100, exit_price: 90, take_profit: 120 }),
    ]);

    const early = segments.find((s) => s.value === "Closed short of target")!;
    const ran = segments.find((s) => s.value === "Ran to target")!;
    expect(early.stats.trades).toBe(2);
    expect(ran.stats.trades).toBe(1);
  });

  it("buckets the day of week in the trader's timezone", () => {
    // 01:00 UTC Tuesday is 9pm Monday in New York.
    const segments = segmentsFor("day", [row({ exit_date: "2026-08-11T01:00:00Z" })]);
    expect(segments[0].value).toBe("Monday");
  });

  it("normalises tickers so one instrument is one segment", () => {
    const segments = segmentsFor("ticker", [row({ ticker: "nvda" }), row({ ticker: " NVDA " })]);
    expect(segments).toHaveLength(1);
    expect(segments[0].stats.trades).toBe(2);
  });

  it("offers no dimension for sector or market regime", () => {
    // Neither is derivable from stored data -- see the header of queries.ts.
    const ids = edgeDimensions(NY).map((d) => d.id);
    expect(ids).not.toContain("sector");
    expect(ids).not.toContain("regime");
  });
});

describe("edge dimensions — drill-down", () => {
  it("links a strategy by id, not by name", () => {
    // /trades filters strategies by id; linking the name would filter nothing.
    const segments = segmentsFor("strategy", [row()]);
    expect(segments[0].drillDownUrl).toBe("/trades?strategy=s-1");
  });

  it("links direction, market and emotion to their own filters", () => {
    expect(segmentsFor("direction", [row()])[0].drillDownUrl).toBe("/trades?direction=long");
    expect(segmentsFor("market", [row()])[0].drillDownUrl).toBe("/trades?market=US");
    expect(segmentsFor("emotion", [row()])[0].drillDownUrl).toBe("/trades?emotion=calm");
  });

  it("links a ticker through the search filter", () => {
    expect(segmentsFor("ticker", [row()])[0].drillDownUrl).toBe("/trades?q=NVDA");
  });

  it("links a risk band to the matching half-open range", () => {
    const byValue = Object.fromEntries(
      segmentsFor("risk", [
        row({ risk_percent: 0.3 }),
        row({ risk_percent: 0.8 }),
        row({ risk_percent: 4 }),
      ]).map((s) => [s.value, s.drillDownUrl]),
    );

    // No lower bound on the first band and no upper bound on the last: an
    // invented limit would exclude trades the segment counted.
    expect(byValue["Under 0.5%"]).toBe("/trades?riskMax=0.5");
    expect(byValue["0.5–1%"]).toBe("/trades?riskMin=0.5&riskMax=1");
    expect(byValue["2% or more"]).toBe("/trades?riskMin=2");
  });

  it("offers no link for dimensions the trades page cannot filter", () => {
    // Computed from timestamps, so no server-side filter reproduces them.
    expect(segmentsFor("day", [row()])[0].drillDownUrl).toBeNull();
    expect(segmentsFor("holding", [row()])[0].drillDownUrl).toBeNull();
    expect(segmentsFor("exit", [row()])[0].drillDownUrl).toBeNull();
  });

  it("escapes a value that would otherwise break the url", () => {
    const segments = segmentsFor("emotion", [row({ emotion_before: ["fear & greed"] })]);
    expect(segments[0].drillDownUrl).toBe("/trades?emotion=fear%20%26%20greed");
  });
});
