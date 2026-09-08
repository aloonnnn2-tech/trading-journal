import { describe, expect, it } from "vitest";
import {
  buildAllSegments,
  buildSegments,
  MIN_SEGMENT_TRADES,
  MIN_SEGMENT_WITH_R,
  rankSegments,
  summariseSegment,
  type Dimension,
  type SegmentableTrade,
} from "./engine";

// This module exists so four features stop each having their own definition of
// win rate and expectancy. These tests pin those definitions, and pin the
// sample floors that stop a three-trade fluke being ranked as an edge.

interface T extends SegmentableTrade {
  strategy: string[];
  direction: string | null;
}

function t(over: Partial<T> = {}): T {
  return {
    id: `t-${Math.random()}`,
    dollar_pl: 100,
    r_multiple: 1,
    strategy: ["Breakout"],
    direction: "long",
    ...over,
  };
}

const byStrategy: Dimension<T> = {
  id: "strategy",
  label: "Strategy",
  valuesOf: (trade) => trade.strategy,
  drillDown: (value) => `/trades?q=${value}`,
};

const byDirection: Dimension<T> = {
  id: "direction",
  label: "Direction",
  valuesOf: (trade) => (trade.direction ? [trade.direction] : []),
};

/** n trades in one strategy, each at the given R. */
function group(n: number, r = 1, strategy = "Breakout"): T[] {
  return Array.from({ length: n }, () => t({ r_multiple: r, dollar_pl: r * 100, strategy: [strategy] }));
}

describe("summariseSegment", () => {
  it("defines a win as net P&L above zero", () => {
    // Matches every other win rate in the app; dollar_pl is stored net of
    // commission, so this means "actually made money".
    const stats = summariseSegment([t({ dollar_pl: 1 }), t({ dollar_pl: 0 }), t({ dollar_pl: -1 })]);
    expect(stats.wins).toBe(1);
    expect(stats.winRate).toBeCloseTo(1 / 3);
  });

  it("defines expectancy as average R over R-bearing trades only", () => {
    // Same as getAnalyticsSummary's rSum / rCount, and in R, not dollars.
    const stats = summariseSegment([
      t({ r_multiple: 2 }),
      t({ r_multiple: -1 }),
      t({ r_multiple: null }),
    ]);
    expect(stats.expectancy).toBeCloseTo(0.5);
    expect(stats.withR).toBe(2);
    expect(stats.trades).toBe(3);
  });

  it("returns a null expectancy rather than zero when no R is recorded", () => {
    const stats = summariseSegment([t({ r_multiple: null })]);
    expect(stats.expectancy).toBeNull();
    expect(stats.totalR).toBe(0);
  });

  it("handles an empty segment without dividing by zero", () => {
    const stats = summariseSegment([]);
    expect(stats).toMatchObject({ trades: 0, winRate: null, expectancy: null, totalPL: 0 });
  });
});

describe("buildSegments", () => {
  it("groups by the dimension's labels, largest first", () => {
    const segments = buildSegments([...group(3), ...group(1, 1, "Reversal")], byStrategy);
    expect(segments.map((s) => [s.value, s.stats.trades])).toEqual([
      ["Breakout", 3],
      ["Reversal", 1],
    ]);
  });

  it("counts a multi-valued trade in every segment it belongs to", () => {
    // A trade really can use two strategies; it is a data point for both.
    const segments = buildSegments([t({ strategy: ["Breakout", "Reversal"] })], byStrategy);
    expect(segments).toHaveLength(2);
    expect(segments.every((s) => s.stats.trades === 1)).toBe(true);
  });

  it("counts a trade once when a label repeats on it", () => {
    const segments = buildSegments([t({ strategy: ["Breakout", "Breakout"] })], byStrategy);
    expect(segments[0].stats.trades).toBe(1);
  });

  it("creates no segment when the dimension does not apply", () => {
    // An empty label list means "not applicable", which must not become a
    // phantom cohort of unlabelled trades.
    const segments = buildSegments([t({ direction: null })], byDirection);
    expect(segments).toHaveLength(0);
  });

  it("attaches a drill-down url when the dimension can express one", () => {
    const segments = buildSegments(group(2), byStrategy);
    expect(segments[0].drillDownUrl).toBe("/trades?q=Breakout");
  });

  it("leaves the drill-down null when no filter exists for the dimension", () => {
    // Honest: direction has no server-side filter, and a link showing the
    // wrong trades would be worse than no link.
    const segments = buildSegments(group(2), byDirection);
    expect(segments[0].drillDownUrl).toBeNull();
  });

  it("keeps the trades behind each segment for drill-down", () => {
    const trades = group(3);
    const segments = buildSegments(trades, byStrategy);
    expect(segments[0].trades.map((x) => x.id).sort()).toEqual(trades.map((x) => x.id).sort());
  });
});

describe("buildAllSegments", () => {
  it("cuts by every dimension in one pass", () => {
    const segments = buildAllSegments([...group(2), ...group(2, 1, "Reversal")], [
      byStrategy,
      byDirection,
    ]);
    expect(segments.filter((s) => s.dimensionId === "strategy")).toHaveLength(2);
    expect(segments.filter((s) => s.dimensionId === "direction")).toHaveLength(1);
  });
});

describe("rankSegments", () => {
  it("ranks by expectancy, not by win rate", () => {
    // The whole reason this beats the existing deviation view: a 70%-win
    // segment at +0.2R is worse than a 40%-win segment at +1.5R.
    const highWinLowR = group(10, 0.2, "Scalps");
    const lowWinHighR = group(10, 1.5, "Runners");

    const segments = buildSegments([...highWinLowR, ...lowWinHighR], byStrategy);
    const { edges } = rankSegments(segments);

    expect(edges[0].value).toBe("Runners");
    expect(edges[edges.length - 1].value).toBe("Scalps");
  });

  it("puts the worst expectancy first among leaks", () => {
    const segments = buildSegments([...group(8, 1), ...group(8, -1, "Fades")], byStrategy);
    expect(rankSegments(segments).leaks[0].value).toBe("Fades");
  });

  it("excludes a segment below the trade floor rather than ranking it top", () => {
    // A three-trade segment at +4R is not a weak edge; it is not an edge.
    const segments = buildSegments(
      [...group(MIN_SEGMENT_TRADES - 1, 4, "Fluke"), ...group(10, 1)],
      byStrategy,
    );
    const { edges, excludedForSample } = rankSegments(segments);

    expect(edges.map((s) => s.value)).not.toContain("Fluke");
    expect(excludedForSample).toBe(1);
  });

  it("excludes a segment whose expectancy rests on too few R-bearing trades", () => {
    const thin = [
      ...group(MIN_SEGMENT_WITH_R - 1, 3, "Thin"),
      ...Array.from({ length: 10 }, () =>
        t({ r_multiple: null, dollar_pl: 50, strategy: ["Thin"] }),
      ),
    ];
    const segments = buildSegments([...thin, ...group(10, 1)], byStrategy);
    const thinSegment = segments.find((s) => s.value === "Thin")!;

    // Plenty of trades, almost no R multiples -- a four-trade average.
    expect(thinSegment.stats.trades).toBe(14);
    expect(thinSegment.stats.withR).toBe(MIN_SEGMENT_WITH_R - 1);
    expect(rankSegments(segments).edges.map((s) => s.value)).not.toContain("Thin");
  });

  it("breaks a tie towards the larger sample", () => {
    const segments = buildSegments([...group(20, 1, "Big"), ...group(6, 1, "Small")], byStrategy);
    expect(rankSegments(segments).edges[0].value).toBe("Big");
  });

  it("returns nothing rather than guessing when every segment is too small", () => {
    const { edges, leaks } = rankSegments(buildSegments(group(2), byStrategy));
    expect(edges).toEqual([]);
    expect(leaks).toEqual([]);
  });

  it("respects caller-supplied floors", () => {
    const segments = buildSegments(group(3, 1), byStrategy);
    expect(rankSegments(segments, { minTrades: 3, minWithR: 3 }).edges).toHaveLength(1);
  });
});

describe("summariseSegment — the scorecard stats", () => {
  it("matches getAnalyticsSummary's definitions of avg win, avg loss and profit factor", () => {
    // grossWin 300 over 2 winners, grossLoss 100 over 2 losers.
    const stats = summariseSegment([
      t({ dollar_pl: 200 }),
      t({ dollar_pl: 100 }),
      t({ dollar_pl: -60 }),
      t({ dollar_pl: -40 }),
    ]);

    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(2);
    expect(stats.avgWin).toBeCloseTo(150);
    // Positive, as getAnalyticsSummary reports it -- not -50.
    expect(stats.avgLoss).toBeCloseTo(50);
    expect(stats.profitFactor).toBeCloseTo(3);
  });

  it("counts break-even as neither a win nor a loss", () => {
    const stats = summariseSegment([t({ dollar_pl: 0 }), t({ dollar_pl: 100 })]);
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(0);
    // Still in the denominator of the win rate, which is why it is 50%.
    expect(stats.winRate).toBeCloseTo(0.5);
  });

  it("returns a null profit factor when nothing was lost", () => {
    // Infinity is not a large number, and rendering it as one would suggest a
    // measured result where there is none.
    const stats = summariseSegment([t({ dollar_pl: 100 }), t({ dollar_pl: 50 })]);
    expect(stats.profitFactor).toBeNull();
    expect(stats.avgLoss).toBeNull();
  });

  it("measures drawdown as the deepest fall from a running peak", () => {
    // +100 (peak 100), -60 (equity 40, dd -60), +20 (60), -30 (30, dd -70).
    const stats = summariseSegment([
      t({ dollar_pl: 100 }),
      t({ dollar_pl: -60 }),
      t({ dollar_pl: 20 }),
      t({ dollar_pl: -30 }),
    ]);
    expect(stats.maxDrawdown).toBeCloseTo(-70);
  });

  it("reports no drawdown when the segment only ever rose", () => {
    const stats = summariseSegment([t({ dollar_pl: 50 }), t({ dollar_pl: 50 })]);
    expect(stats.maxDrawdown).toBe(0);
  });

  it("counts an opening loss as drawdown from a zero peak", () => {
    const stats = summariseSegment([t({ dollar_pl: -40 }), t({ dollar_pl: 10 })]);
    expect(stats.maxDrawdown).toBeCloseTo(-40);
  });

  it("depends on the order it is given, which is why callers sort", () => {
    // The same three trades in two orders give genuinely different drawdowns:
    //   -30, +100, -30  ->  dips 30 below a zero peak, then only ever rises
    //   +100, -30, -30  ->  peaks at 100 and falls 60 from there
    // Documented on the field: pass them chronologically or it means nothing.
    const a = [t({ dollar_pl: -30 }), t({ dollar_pl: 100 }), t({ dollar_pl: -30 })];
    const b = [a[1], a[0], a[2]];

    expect(summariseSegment(a).maxDrawdown).toBeCloseTo(-30);
    expect(summariseSegment(b).maxDrawdown).toBeCloseTo(-60);
    // Totals are order-independent even though the path is not.
    expect(summariseSegment(a).totalPL).toBeCloseTo(summariseSegment(b).totalPL);
  });

  it("gives an empty segment neutral values rather than dividing by zero", () => {
    expect(summariseSegment([])).toMatchObject({
      avgWin: null,
      avgLoss: null,
      profitFactor: null,
      maxDrawdown: 0,
      losses: 0,
    });
  });
});
