import { describe, expect, it } from "vitest";
import {
  analyseMistakes,
  detectMistakes,
  DETECTED_LABELS,
  medianRiskPercent,
  MIN_COMPARISON_SAMPLE,
  summariseCohort,
  type MistakeTrade,
} from "./analyze";

// The risk in this feature is not arithmetic, it is overclaiming. These tests
// pin the guards that keep "trades where this happened performed worse" from
// becoming "this mistake cost you 0.59R" on a sample of four.

function t(over: Partial<MistakeTrade> = {}): MistakeTrade {
  return {
    id: `t-${Math.random()}`,
    ticker: "NVDA",
    exit_date: "2026-08-14T19:00:00Z",
    dollar_pl: 100,
    r_multiple: 1,
    risk_percent: 1,
    stop_loss: 95,
    take_profit: 115,
    exit_price: 110,
    direction: "long",
    mistakes: [],
    ...over,
  };
}

/** n trades carrying `label`, each with the given R multiple. */
function cohort(n: number, r: number, label?: string): MistakeTrade[] {
  return Array.from({ length: n }, () =>
    t({
      r_multiple: r,
      dollar_pl: r * 100,
      mistakes: label ? [{ label, source: "tagged" as const }] : [],
    }),
  );
}

describe("summariseCohort", () => {
  it("computes expectancy as average R, matching getAnalyticsSummary", () => {
    // Same definition as the Analytics page (rSum / rCount), so the two can
    // never disagree about the same trades.
    const stats = summariseCohort([t({ r_multiple: 2 }), t({ r_multiple: -1 }), t({ r_multiple: 2 })]);
    expect(stats.expectancy).toBeCloseTo(1);
    expect(stats.withR).toBe(3);
  });

  it("computes expectancy only over trades that have an R multiple", () => {
    const stats = summariseCohort([t({ r_multiple: 2 }), t({ r_multiple: null })]);
    expect(stats.expectancy).toBe(2);
    expect(stats.trades).toBe(2);
    // Reported separately so the UI can say the average rests on one trade.
    expect(stats.withR).toBe(1);
  });

  it("returns a null expectancy when no trade carries an R multiple", () => {
    const stats = summariseCohort([t({ r_multiple: null }), t({ r_multiple: null })]);
    expect(stats.expectancy).toBeNull();
  });

  it("counts a win by P&L, so a break-even trade is not a win", () => {
    const stats = summariseCohort([t({ dollar_pl: 0 }), t({ dollar_pl: 10 })]);
    expect(stats.wins).toBe(1);
    expect(stats.winRate).toBe(0.5);
  });
});

describe("analyseMistakes — frequency", () => {
  it("counts trades per mistake and sorts by frequency", () => {
    const trades = [
      ...cohort(3, 1, "Moved stop"),
      ...cohort(1, 1, "Chased entry"),
      ...cohort(2, 1, "Oversized"),
    ];
    const summaries = analyseMistakes(trades);
    expect(summaries.map((s) => [s.label, s.withMistake.trades])).toEqual([
      ["Moved stop", 3],
      ["Oversized", 2],
      ["Chased entry", 1],
    ]);
  });

  it("counts a trade once per mistake even when a source repeats it", () => {
    const trade = t({
      mistakes: [
        { label: "Moved stop", source: "detected" },
        { label: "Moved stop", source: "tagged" },
      ],
    });
    const summaries = analyseMistakes([trade]);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].withMistake.trades).toBe(1);
    // Both origins are recorded, so the UI can show where it came from.
    expect(summaries[0].sources.sort()).toEqual(["detected", "tagged"]);
  });

  it("lists the trades behind a mistake so it can be drilled into", () => {
    const trades = cohort(2, 1, "Moved stop");
    const summaries = analyseMistakes(trades);
    expect(summaries[0].tradeIds.sort()).toEqual(trades.map((x) => x.id).sort());
  });
});

describe("analyseMistakes — the comparison is withheld unless it is supportable", () => {
  it("withholds the gap when the mistake cohort is too small", () => {
    const trades = [
      ...cohort(MIN_COMPARISON_SAMPLE - 1, -1, "Moved stop"),
      ...cohort(20, 1),
    ];
    const summary = analyseMistakes(trades)[0];

    // Frequency still reported -- "you did this 4 times" needs no statistics.
    expect(summary.withMistake.trades).toBe(MIN_COMPARISON_SAMPLE - 1);
    expect(summary.expectancyGap).toBeNull();
  });

  it("withholds the gap when the clean cohort is too small", () => {
    const trades = [...cohort(20, -1, "Moved stop"), ...cohort(MIN_COMPARISON_SAMPLE - 1, 1)];
    expect(analyseMistakes(trades)[0].expectancyGap).toBeNull();
  });

  it("reports the gap once both sides clear the threshold", () => {
    const trades = [...cohort(6, -0.5, "Moved stop"), ...cohort(10, 1)];
    const summary = analyseMistakes(trades)[0];

    expect(summary.withMistake.expectancy).toBeCloseTo(-0.5);
    expect(summary.withoutMistake.expectancy).toBeCloseTo(1);
    expect(summary.expectancyGap).toBeCloseTo(-1.5);
  });

  it("counts the threshold against R-bearing trades, not raw trade count", () => {
    // Twelve trades of which two have an R multiple is a two-trade comparison
    // wearing a twelve. Without this it would look statistically respectable.
    const withMistake = [
      ...cohort(2, -1, "Moved stop"),
      ...Array.from({ length: 10 }, () =>
        t({ r_multiple: null, mistakes: [{ label: "Moved stop", source: "tagged" as const }] }),
      ),
    ];
    const summary = analyseMistakes([...withMistake, ...cohort(20, 1)])[0];

    expect(summary.withMistake.trades).toBe(12);
    expect(summary.withMistake.withR).toBe(2);
    expect(summary.expectancyGap).toBeNull();
  });

  it("compares against every other trade, not against a spotless subset", () => {
    // Comparing to "trades with no mistakes at all" would shrink the clean
    // cohort as more mistakes are tracked, so a diligent logger would appear
    // to be getting worse.
    const trades = [
      ...cohort(6, -1, "Moved stop"),
      ...cohort(6, 0.5, "Chased entry"),
      ...cohort(6, 1),
    ];
    const movedStop = analyseMistakes(trades).find((s) => s.label === "Moved stop")!;
    expect(movedStop.withoutMistake.trades).toBe(12);
  });
});

describe("detectMistakes", () => {
  const base = { stopMoved: false, targetMoved: false, medianRisk: 1 };

  it("flags a moved stop", () => {
    expect(detectMistakes({ trade: t(), ...base, stopMoved: true })).toContain(
      DETECTED_LABELS.movedStop,
    );
  });

  it("does not flag anything when nothing moved", () => {
    expect(detectMistakes({ trade: t(), ...base })).not.toContain(DETECTED_LABELS.movedStop);
  });

  it("treats unknown history as not-a-mistake rather than a mistake", () => {
    expect(
      detectMistakes({ trade: t(), ...base, stopMoved: null, targetMoved: null }),
    ).not.toContain(DETECTED_LABELS.movedStop);
  });

  it("flags an early exit only on a winner", () => {
    // Exiting short of target on a loser is a stop being hit -- the plan
    // working, not a mistake.
    const winner = t({ dollar_pl: 100, exit_price: 110, take_profit: 120 });
    const loser = t({ dollar_pl: -100, exit_price: 95, take_profit: 120 });

    expect(detectMistakes({ trade: winner, ...base })).toContain(DETECTED_LABELS.exitedEarly);
    expect(detectMistakes({ trade: loser, ...base })).not.toContain(DETECTED_LABELS.exitedEarly);
  });

  it("is direction-aware about an early exit", () => {
    // A short's target sits BELOW entry, so a higher exit is the early one.
    const shortEarly = t({
      direction: "short",
      dollar_pl: 100,
      exit_price: 105,
      take_profit: 100,
    });
    expect(detectMistakes({ trade: shortEarly, ...base })).toContain(DETECTED_LABELS.exitedEarly);
  });

  it("does not flag an early exit when no target was recorded", () => {
    const noTarget = t({ dollar_pl: 100, take_profit: null });
    expect(detectMistakes({ trade: noTarget, ...base })).not.toContain(
      DETECTED_LABELS.exitedEarly,
    );
  });

  it("flags oversizing against the trader's own median", () => {
    const big = t({ risk_percent: 2 }); // median 1, threshold 1.5
    const normal = t({ risk_percent: 1.4 });
    expect(detectMistakes({ trade: big, ...base })).toContain(DETECTED_LABELS.oversized);
    expect(detectMistakes({ trade: normal, ...base })).not.toContain(DETECTED_LABELS.oversized);
  });

  it("does not flag oversizing when there is no baseline", () => {
    const big = t({ risk_percent: 9 });
    expect(detectMistakes({ trade: big, ...base, medianRisk: null })).not.toContain(
      DETECTED_LABELS.oversized,
    );
  });

  it("does not flag oversizing when risk wasn't recorded", () => {
    expect(detectMistakes({ trade: t({ risk_percent: null }), ...base })).not.toContain(
      DETECTED_LABELS.oversized,
    );
  });
});

describe("medianRiskPercent", () => {
  it("returns null below the sample threshold — one number is not a habit", () => {
    expect(medianRiskPercent(cohort(MIN_COMPARISON_SAMPLE - 1, 1))).toBeNull();
  });

  it("computes the median once there is enough history", () => {
    const trades = [0.5, 1, 1, 2, 10].map((risk) => t({ risk_percent: risk }));
    // Median, not mean: one 10% outlier must not redefine "normal".
    expect(medianRiskPercent(trades)).toBe(1);
  });

  it("ignores trades with no risk recorded", () => {
    const trades = [
      ...[1, 1, 1, 1, 3].map((risk) => t({ risk_percent: risk })),
      ...cohort(5, 1).map((x) => ({ ...x, risk_percent: null })),
    ];
    expect(medianRiskPercent(trades)).toBe(1);
  });
});
