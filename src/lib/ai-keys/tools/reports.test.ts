import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getReport } from "./reports";
import type { ToolContext } from "./journal";
import type { TradeStore } from "./store";

// get_report wraps analytics modules that fetch on their own. The regime one
// carries every trade of each band in its segments, which must never reach
// the model as raw rows: it is a data dump the tool budget was built to
// prevent, and on the free tier it overflowed the ceiling every time.

vi.mock("@/lib/regime/queries", () => ({
  getRegimeReport: vi.fn(async () => ({
    available: true,
    benchmark: "SPY",
    medianVolatility: 0.1234567,
    tradesAnalysed: 3,
    excludedByAsset: 1,
    unmatched: 0,
    segments: [
      {
        dimensionId: "regime",
        dimensionLabel: "Volatility",
        value: "high",
        stats: { trades: 2, wins: 1, winRate: 0.5, expectancy: 0.75, withR: 2, totalR: 1.5, totalPL: 150.456, losses: 1 },
        trades: [
          { id: "t1", dollar_pl: 200, r_multiple: 2, exit_date: "2026-01-06", asset_type: "stock", secret_note: "x" },
          { id: "t2", dollar_pl: -50, r_multiple: -0.5, exit_date: "2026-01-07", asset_type: "stock" },
        ],
        drillDownUrl: "/trades?x=1",
      },
      {
        dimensionId: "regime",
        dimensionLabel: "Volatility",
        value: "low",
        stats: { trades: 1, wins: 0, winRate: 0, expectancy: -1, withR: 1, totalR: -1, totalPL: -100, losses: 1 },
        trades: [{ id: "t3", dollar_pl: -100, r_multiple: -1, exit_date: "2026-02-03", asset_type: "stock" }],
        drillDownUrl: null,
      },
    ],
  })),
}));

const ctx: ToolContext = {
  supabase: {} as SupabaseClient,
  store: {} as TradeStore,
  timezone: "UTC",
  outputBudget: 6_000,
};

describe("get_report regime", () => {
  it("projects each band to its statistics and drops the per-trade rows", async () => {
    const r = (await getReport(ctx, { kind: "regime" })) as Record<string, unknown>;
    expect(r.bands).toEqual([
      { band: "high", trades: 2, winRate: 0.5, expectancyR: 0.75, totalPL: 150.46 },
      { band: "low", trades: 1, winRate: 0, expectancyR: -1, totalPL: -100 },
    ]);
    expect(r.medianVolatility).toBe(0.1235);
    expect(r.tradesAnalysed).toBe(3);
    const text = JSON.stringify(r);
    expect(text).not.toContain("t1");
    expect(text).not.toContain("drillDownUrl");
    expect(text).not.toContain("segments");
  });
});
