import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getInsights } from "./queries";

// Characterization tests: these were written to pin what /insights ALREADY
// does before its arithmetic was moved onto the shared segmentation engine
// (lib/segments). The page had no tests, and refactoring untested code on the
// promise that nothing changed is not a promise anyone can check.
//
// If one of these fails, the refactor changed user-visible behaviour.

function row(over: Record<string, unknown> = {}) {
  return {
    exit_date: "2026-08-10T19:00:00Z", // a Monday in New York
    dollar_pl: 100,
    direction: "long",
    risk_percent: 0.5,
    emotion_before: ["calm"],
    trade_strategies: [{ strategies: [{ name: "Breakout" }] }],
    ...over,
  };
}

function fakeSupabase(trades: Record<string, unknown>[]) {
  const from = () => {
    const chain: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: trades, error: null }).then(resolve),
    };
    for (const m of ["select", "eq", "not", "neq", "order", "range", "limit"]) {
      chain[m] = () => chain;
    }
    return chain;
  };
  return { from } as unknown as SupabaseClient;
}

const NY = "America/New_York";

/** n trades in one segment, `wins` of which made money. */
function segment(n: number, wins: number, over: Record<string, unknown> = {}) {
  return Array.from({ length: n }, (_, i) => row({ ...over, dollar_pl: i < wins ? 100 : -100 }));
}

describe("getInsights", () => {
  it("emits no insight when there are too few trades overall", async () => {
    const insights = await getInsights(fakeSupabase(segment(4, 2)), NY);
    expect(insights).toEqual([]);
  });

  it("emits no insight when a segment does not deviate enough", async () => {
    // Every trade in one strategy at the overall win rate: nothing to say.
    const insights = await getInsights(fakeSupabase(segment(10, 5)), NY);
    const strategyInsights = insights.filter((i) => i.segmentLabel === "Breakout");
    expect(strategyInsights).toEqual([]);
  });

  it("flags a segment whose win rate is far above the overall rate", async () => {
    const trades = [
      ...segment(10, 9, { trade_strategies: [{ strategies: [{ name: "Breakout" }] }] }),
      ...segment(10, 1, { trade_strategies: [{ strategies: [{ name: "Fade" }] }] }),
    ];
    const insights = await getInsights(fakeSupabase(trades), NY);

    const breakout = insights.find((i) => i.segmentLabel === "Breakout");
    expect(breakout).toBeDefined();
    expect(breakout!.direction).toBe("positive");
    expect(breakout!.trades).toBe(10);
    expect(breakout!.segmentWinRate).toBeCloseTo(0.9);
    expect(breakout!.overallWinRate).toBeCloseTo(0.5);
  });

  it("flags a segment far below as negative", async () => {
    const trades = [
      ...segment(10, 9, { trade_strategies: [{ strategies: [{ name: "Breakout" }] }] }),
      ...segment(10, 1, { trade_strategies: [{ strategies: [{ name: "Fade" }] }] }),
    ];
    const insights = await getInsights(fakeSupabase(trades), NY);
    expect(insights.find((i) => i.segmentLabel === "Fade")!.direction).toBe("negative");
  });

  it("counts a win as net P&L above zero, so break-even is not a win", async () => {
    const trades = [
      ...Array.from({ length: 10 }, () => row({ dollar_pl: 0 })),
      ...segment(10, 10, { trade_strategies: [{ strategies: [{ name: "Winner" }] }] }),
    ];
    const insights = await getInsights(fakeSupabase(trades), NY);
    // 10 break-evens + 10 wins = 50% overall, so the all-win segment deviates.
    expect(insights.find((i) => i.segmentLabel === "Winner")!.overallWinRate).toBeCloseTo(0.5);
  });

  it("buckets the day of week in the trader's timezone, not UTC", async () => {
    // 2026-08-11T01:00 UTC is Tuesday in UTC but 9pm MONDAY in New York.
    // Bucketing by UTC would label this segment Tuesday -- the exact bug
    // local-day.ts exists to prevent.
    const trades = [
      ...segment(10, 9, { exit_date: "2026-08-11T01:00:00Z" }),
      // A genuinely different local day, so the winning group deviates.
      ...segment(10, 1, {
        exit_date: "2026-08-12T19:00:00Z",
        trade_strategies: [{ strategies: [{ name: "Other" }] }],
      }),
    ];
    const insights = await getInsights(fakeSupabase(trades), NY);
    const dayInsight = insights.find((i) => ["Monday", "Tuesday"].includes(i.segmentLabel));

    expect(dayInsight?.segmentLabel).toBe("Monday");
    expect(dayInsight?.direction).toBe("positive");
  });

  it("segments emotions from the projected jsonb key", async () => {
    const trades = [
      ...segment(10, 9, { emotion_before: ["calm"] }),
      ...segment(10, 1, { emotion_before: ["fomo"] }),
    ];
    const insights = await getInsights(fakeSupabase(trades), NY);
    expect(insights.some((i) => i.segmentLabel === "calm")).toBe(true);
    expect(insights.some((i) => i.segmentLabel === "fomo")).toBe(true);
  });

  it("carries chart data covering every large-enough segment in the dimension", async () => {
    const trades = [
      ...segment(10, 9, { trade_strategies: [{ strategies: [{ name: "Breakout" }] }] }),
      ...segment(10, 1, { trade_strategies: [{ strategies: [{ name: "Fade" }] }] }),
    ];
    const insights = await getInsights(fakeSupabase(trades), NY);
    const breakout = insights.find((i) => i.segmentLabel === "Breakout")!;

    expect(breakout.chart.map((c) => c.label).sort()).toEqual(["Breakout", "Fade"]);
    expect(breakout.chart.every((c) => c.trades === 10)).toBe(true);
  });
});
