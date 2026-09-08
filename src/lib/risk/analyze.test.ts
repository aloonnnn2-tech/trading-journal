import { describe, expect, it } from "vitest";
import { buildRiskReport, MIN_COMPARISON, OUTLIER_MULTIPLE, type RiskTrade } from "./analyze";

// Two properties matter here. First, the sequence and drawdown comparisons are
// about the state BEFORE a trade -- get that backwards and the feature reports
// consequences as causes. Second, nothing is measured against an external
// notion of correct risk; every judgement is relative to this trader's own
// distribution.

function t(over: Partial<RiskTrade> = {}): RiskTrade {
  return {
    id: `t-${Math.random()}`,
    ticker: "NVDA",
    exit_date: "2026-08-14T19:00:00Z",
    dollar_pl: 100,
    r_multiple: 1,
    risk_percent: 1,
    position_size: 1000,
    ...over,
  };
}

/** n trades at a given risk and outcome. */
function many(n: number, risk: number, pl = 100): RiskTrade[] {
  return Array.from({ length: n }, () => t({ risk_percent: risk, dollar_pl: pl }));
}

describe("buildRiskReport — spread", () => {
  it("reports the shape of the risk distribution", () => {
    const report = buildRiskReport([
      t({ risk_percent: 0.5 }),
      t({ risk_percent: 1 }),
      t({ risk_percent: 1.5 }),
    ]);

    expect(report.risk.n).toBe(3);
    expect(report.risk.median).toBeCloseTo(1);
    expect(report.risk.mean).toBeCloseTo(1);
    expect(report.risk.min).toBeCloseTo(0.5);
    expect(report.risk.max).toBeCloseTo(1.5);
    expect(report.risk.stdev).toBeGreaterThan(0);
  });

  it("ignores trades with no risk recorded rather than counting them as zero", () => {
    const report = buildRiskReport([t({ risk_percent: 1 }), t({ risk_percent: null })]);
    expect(report.risk.n).toBe(1);
    expect(report.risk.mean).toBeCloseTo(1);
    // The trade still counted toward the journal considered.
    expect(report.tradesConsidered).toBe(2);
  });

  it("has no standard deviation for a single value", () => {
    // Spread is not a meaningful idea for one number.
    expect(buildRiskReport([t()]).risk.stdev).toBeNull();
  });

  it("puts each trade in exactly one distribution band", () => {
    const trades = [0.1, 0.3, 0.75, 1.5, 3, 9].map((risk) => t({ risk_percent: risk }));
    const report = buildRiskReport(trades);

    expect(report.distribution.reduce((n, b) => n + b.trades, 0)).toBe(6);
    expect(report.distribution.every((b) => b.trades === 1)).toBe(true);
  });

  it("puts a boundary value in the upper band", () => {
    // Half-open [min, max): exactly 1% belongs to "1-2%".
    const report = buildRiskReport([t({ risk_percent: 1 })]);
    const byLabel = Object.fromEntries(report.distribution.map((b) => [b.label, b.trades]));
    expect(byLabel["0.5–1%"]).toBe(0);
    expect(byLabel["1–2%"]).toBe(1);
  });
});

describe("buildRiskReport — sequence", () => {
  it("measures the risk on the trade that FOLLOWED a loss, not on losing trades", () => {
    // Alternating loss/win, with the trade after each loss risking 2% and the
    // trade after each win risking 0.5%.
    const trades: RiskTrade[] = [];
    for (let i = 0; i < 12; i++) {
      const previousWasLoss = i > 0 && i % 2 === 1;
      trades.push(
        t({ dollar_pl: i % 2 === 0 ? -50 : 50, risk_percent: previousWasLoss ? 2 : 0.5 }),
      );
    }
    const report = buildRiskReport(trades);

    expect(report.sequence.afterLoss.mean).toBeCloseTo(2);
    expect(report.sequence.afterWin.mean).toBeCloseTo(0.5);
  });

  it("treats a break-even trade as starting neither sequence", () => {
    const trades = [t({ dollar_pl: 0 }), ...many(MIN_COMPARISON, 1, 50)];
    const report = buildRiskReport(trades);
    // The trade after the break-even is in neither bucket, so the win side is
    // one short of the wins that preceded it.
    expect(report.sequence.afterLoss.n + report.sequence.afterWin.n).toBe(trades.length - 2);
  });

  it("withholds the mean until both sides have enough trades", () => {
    const report = buildRiskReport([
      t({ dollar_pl: -50 }),
      t({ dollar_pl: 50, risk_percent: 5 }),
    ]);
    expect(report.sequence.afterLoss.n).toBe(1);
    // One trade is a number, not an average worth reading.
    expect(report.sequence.afterLoss.mean).toBeNull();
  });
});

describe("buildRiskReport — drawdown", () => {
  it("classifies by the account state BEFORE the trade, not its result", () => {
    // A big loss first, then trades taken while the account is underwater.
    const trades = [
      t({ dollar_pl: -1000, risk_percent: 1 }), // taken at a high: equity 0
      ...many(6, 3, -10), // taken while underwater
    ];
    const report = buildRiskReport(trades);

    expect(report.drawdown.atHighs.n).toBe(1);
    expect(report.drawdown.inDrawdown.n).toBe(6);
    expect(report.drawdown.inDrawdown.mean).toBeCloseTo(3);
  });

  it("counts trades at a new high as not in drawdown", () => {
    const report = buildRiskReport(many(6, 1, 100));
    expect(report.drawdown.inDrawdown.n).toBe(0);
    expect(report.drawdown.atHighs.n).toBe(6);
  });

  it("returns to 'at highs' once the account recovers", () => {
    const trades = [
      t({ dollar_pl: -100, risk_percent: 1 }), // at high
      t({ dollar_pl: 200, risk_percent: 1 }), // in drawdown (equity -100)
      t({ dollar_pl: 10, risk_percent: 1 }), // recovered: equity 100 = new peak
    ];
    const report = buildRiskReport(trades);
    expect(report.drawdown.inDrawdown.n).toBe(1);
    expect(report.drawdown.atHighs.n).toBe(2);
  });
});

describe("buildRiskReport — outliers", () => {
  it("flags trades far above the trader's own median", () => {
    const trades = [...many(10, 1), t({ risk_percent: 1 * OUTLIER_MULTIPLE + 0.5, ticker: "TSLA" })];
    const report = buildRiskReport(trades);

    expect(report.outliers).toHaveLength(1);
    expect(report.outliers[0].ticker).toBe("TSLA");
    expect(report.outliers[0].timesMedian).toBeGreaterThan(OUTLIER_MULTIPLE);
  });

  it("judges against this trader's scale, not an absolute percentage", () => {
    // A 0.6% trade is an outlier for someone whose median is 0.1%, and a 2%
    // trade is not for someone whose median is 1%.
    const small = buildRiskReport([...many(10, 0.1), t({ risk_percent: 0.6 })]);
    const large = buildRiskReport([...many(10, 1), t({ risk_percent: 2 })]);

    expect(small.outliers).toHaveLength(1);
    expect(large.outliers).toHaveLength(0);
  });

  it("reports the biggest first", () => {
    const report = buildRiskReport([...many(10, 1), t({ risk_percent: 4 }), t({ risk_percent: 9 })]);
    expect(report.outliers.map((o) => o.riskPercent)).toEqual([9, 4]);
  });

  it("flags nothing when there is no median to compare against", () => {
    expect(buildRiskReport([t({ risk_percent: null })]).outliers).toEqual([]);
  });
});

describe("buildRiskReport — position sizing", () => {
  it("expresses variation relative to the trader's own average size", () => {
    // Identical sizes vary not at all, whatever the absolute figures.
    expect(buildRiskReport(many(5, 1)).positionSizeVariation).toBeCloseTo(0);
  });

  it("reports higher variation for inconsistent sizing", () => {
    const varied = [100, 5000, 200, 8000, 300].map((size) => t({ position_size: size }));
    expect(buildRiskReport(varied).positionSizeVariation!).toBeGreaterThan(0.5);
  });

  it("has no variation figure without sizes recorded", () => {
    expect(buildRiskReport([t({ position_size: null })]).positionSizeVariation).toBeNull();
  });
});

describe("buildRiskReport — outcome", () => {
  it("reports risk by how the trade turned out, without implying cause", () => {
    const report = buildRiskReport([...many(6, 2, -50), ...many(6, 0.5, 100)]);
    expect(report.outcome.losers.mean).toBeCloseTo(2);
    expect(report.outcome.winners.mean).toBeCloseTo(0.5);
  });

  it("excludes break-even trades from both sides", () => {
    const report = buildRiskReport([...many(6, 1, 0)]);
    expect(report.outcome.winners.n).toBe(0);
    expect(report.outcome.losers.n).toBe(0);
  });
});
