import { describe, expect, it, vi } from "vitest";
import type { ToolContext } from "./journal";

// The value always comes from the function the page itself uses -- so these
// mock exactly those functions and check explain_metric passes their numbers
// through unchanged. If explain_metric ever computed a figure its own way,
// it would stop matching here.

const summary = {
  totalPL: 1234.5,
  closedCount: 40,
  winRate: 0.45,
  profitFactor: 1.62,
  expectancy: 0.21,
  avgWin: 210,
  avgLoss: 120,
  byMonth: Array.from({ length: 30 }, (_, i) => ({ month: `m${i}`, totalPL: i })),
};
const excursions = {
  overall: { trades: 25, avgMaePercent: 1.8, avgMfePercent: 4.2, avgMaeR: -0.42, avgMfeR: 1.9, medianCapture: 0.38 },
  winners: { trades: 12 },
  losers: { trades: 13 },
  byStrategy: [],
  unavailable: {},
  notComputed: 3,
};

vi.mock("@/lib/analytics/queries", () => ({ getAnalyticsSummary: vi.fn(async () => summary) }));
vi.mock("@/lib/dashboard/queries", () => ({ getDashboardStats: vi.fn(async () => ({ todayPL: -45, counts: { all: 3 } })) }));
vi.mock("@/lib/trades/queries", () => ({ listTradesForStreak: vi.fn(async () => []) }));
vi.mock("@/lib/trades/streak", () => ({ computeAttentionStreak: vi.fn(() => 6) }));
vi.mock("./reports", () => ({ getReport: vi.fn(async (_ctx: unknown, { kind }: { kind: string }) => (kind === "excursions" ? excursions : { kind })) }));
vi.mock("./journal", async (orig) => ({
  ...(await orig<typeof import("./journal")>()),
  getTrade: vi.fn(async () => ({ found: true, trade: { ticker: "NVDA", r_multiple: 2.1 } })),
}));

import { explainMetric } from "./metrics";

const ctx = {
  supabase: { from: () => ({ select: () => ({ maybeSingle: async () => ({ data: { hidden_core_fields: [] } }) }) }) },
  timezone: "Asia/Jerusalem",
} as unknown as ToolContext;

describe("explain_metric", () => {
  it("answers 'what's my MAE' with the meaning AND the excursion report's own numbers", async () => {
    const out = (await explainMetric(ctx, { metric: "MAE" })) as Record<string, unknown>;
    expect(out.metric).toBe("mae");
    expect(out.definition).toMatch(/AGAINST the trade/);
    expect(out.how_to_read).toBeTruthy();
    expect(out.caveats).toMatch(/OUTER BOUND/);
    expect(out.your_value).toEqual(excursions);
  });

  it("gives profit factor exactly as the Analytics summary has it", async () => {
    const out = (await explainMetric(ctx, { metric: "profit factor" })) as { your_value: Record<string, unknown> };
    expect(out.your_value).toEqual({ profitFactor: 1.62, closedCount: 40 });
  });

  it("keeps a long monthly history to the latest two years", async () => {
    const out = (await explainMetric(ctx, { metric: "best month" })) as { your_value: { byMonth: unknown[] } };
    expect(out.your_value.byMonth).toHaveLength(24);
  });

  it("reads the dashboard and the streak from their own functions", async () => {
    expect(((await explainMetric(ctx, { metric: "today's p/l" })) as { your_value: unknown }).your_value).toEqual({ todayPL: -45 });
    expect(((await explainMetric(ctx, { metric: "needs-attention streak" })) as { your_value: unknown }).your_value).toEqual({ days: 6 });
  });

  it("asks which trade for a per-trade figure, and reads it when told", async () => {
    const without = (await explainMetric(ctx, { metric: "r multiple" })) as { your_value: Record<string, unknown> };
    expect(without.your_value).toHaveProperty("needs_trade");
    const withTrade = (await explainMetric(ctx, { metric: "r multiple", trade: { ticker: "NVDA" } })) as { your_value: Record<string, unknown> };
    expect(withTrade.your_value).toEqual({ found: true, trade: { ticker: "NVDA", r_multiple: 2.1 } });
  });

  it("lists the known metrics when it doesn't recognise one", async () => {
    const out = (await explainMetric(ctx, { metric: "banana bread" })) as { error: string; known_metrics: string[] };
    expect(out.error).toBeTruthy();
    expect(out.known_metrics).toContain("mae");
  });
});
