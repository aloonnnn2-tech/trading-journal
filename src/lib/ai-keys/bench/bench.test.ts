import { describe, expect, it } from "vitest";
import { BENCH, factsFor } from "./questions";
import type { BenchJournal } from "./journal";
import { factFound, numbersIn, scoreAnswer } from "./score";
import { TOOL_DEFS } from "../tools";

describe("numbersIn", () => {
  it("reads money, percentages and thousands separators", () => {
    expect(numbersIn("You made $1,234.56 (45.2%) over 40 trades, worst -$120")).toEqual([1234.56, 45.2, 40, -120]);
    expect(numbersIn("PF 1.62; down −300")).toEqual([1.62, -300]);
  });

  it("ignores digits inside words and ids", () => {
    expect(numbersIn("gpt-4o and m12 and abc123")).toEqual([]);
  });
});

describe("factFound", () => {
  it("accepts a rounded figure and refuses a different one", () => {
    expect(factFound({ label: "pl", number: 1234.56 }, "about $1,235 total")).toBe(true);
    expect(factFound({ label: "pl", number: 1234.56 }, "about $1,300 total")).toBe(false);
    expect(factFound({ label: "pf", number: 1.6234 }, "a profit factor of 1.62")).toBe(true);
  });

  it("takes a ratio written as a percentage, and a loss written without its sign", () => {
    expect(factFound({ label: "wr", number: 0.4523, percent: true }, "you win 45% of the time")).toBe(true);
    expect(factFound({ label: "loss", number: -120 }, "you lost $120 there")).toBe(true);
  });

  it("matches names regardless of case and underscores", () => {
    expect(factFound({ label: "s", text: ["fomo_entry"] }, "Your FOMO entry setup loses most")).toBe(true);
    expect(factFound({ label: "s", text: ["breakout"] }, "pullbacks lose most")).toBe(false);
  });
});

describe("scoreAnswer", () => {
  it("fails an answer that skips a fact or used none of the expected tools", () => {
    const facts = [{ label: "pl", number: 500 }];
    expect(scoreAnswer(facts, "You made $500.", ["compute_stats"], ["compute_stats"]).pass).toBe(true);
    expect(scoreAnswer(facts, "You made money.", ["compute_stats"], ["compute_stats"]).pass).toBe(false);
    expect(scoreAnswer(facts, "You made $500.", ["compute_stats"], ["get_trade"]).pass).toBe(false);
  });
});

describe("the benchmark questions", () => {
  const empty: BenchJournal = {
    summary: {
      totalPL: 0, closedCount: 0, winRate: null, profitFactor: null, expectancy: null, avgWin: null, avgLoss: null,
      maxDrawdown: 0, equityCurve: [], rMultiples: [], byDirection: [], byTag: [], longestWinStreak: 0,
      longestLossStreak: 0, currentStreak: { type: null, count: 0 }, byMonth: [], bestMonth: null, worstMonth: null,
      avgHoldingDays: null, largestWinner: null, largestLoser: null, avgPositionSize: null,
    },
    excursions: { avgMaePercent: null, avgMfePercent: null, medianCapture: null },
    groups: { strategy: [], day_of_week: [], hour_of_day: [], emotion_before: [] },
    latestNvda: null,
  };

  it("has about twenty uniquely named questions, each replaying real tools", () => {
    const names = new Set(TOOL_DEFS.map((d) => d.name));
    expect(BENCH.length).toBeGreaterThanOrEqual(20);
    expect(new Set(BENCH.map((q) => q.id)).size).toBe(BENCH.length);
    for (const q of BENCH) {
      expect(q.calls.length, q.id).toBeGreaterThan(0);
      for (const c of q.calls) expect(names.has(c.name), `${q.id}: ${c.name}`).toBe(true);
      for (const t of q.tools) expect(names.has(t), `${q.id}: ${t}`).toBe(true);
    }
  });

  it("never demands a figure the journal doesn't have", () => {
    for (const q of BENCH) {
      for (const f of factsFor(q, empty)) {
        if ("number" in f) expect(Number.isFinite(f.number), q.id).toBe(true);
      }
    }
  });
});
