import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeToolExecutor, TOOL_DEFS } from "./tools";
import type { ToolCall } from "./providers/types";

// These tests prove the "real calculations" core: a fixed set of trades goes
// in, and the executors must return EXACT, hand-verified numbers -- because the
// whole point of the tools is that the model no longer does arithmetic in its
// head over a text dump. Nothing here talks to a real database or a real model.

// ---- a fake RLS client -----------------------------------------------------
// Chainable, and thenable so `await supabase.from(t).select().order()` resolves
// (get_account awaits the builder directly); `.range()` resolves a page for
// fetchAllRows. Both return the whole seeded table in one page (< 1000 rows),
// which is exactly how the real single-page case behaves.

type Seed = { trades: Record<string, unknown>[]; account_transactions: Record<string, unknown>[] };

function fakeSupabase(seed: Seed): SupabaseClient {
  const client = {
    from(table: string) {
      const data = table === "trades" ? seed.trades : seed.account_transactions;
      const builder: Record<string, unknown> = {
        select: () => builder,
        order: () => builder,
        eq: () => builder,
        range: () => Promise.resolve({ data, error: null }),
        then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
          resolve({ data, error: null }),
      };
      return builder;
    },
  };
  return client as unknown as SupabaseClient;
}

// A trade with sensible defaults; `strategies` is sugar for the nested join
// shape the real select returns.
function trade(o: {
  id: string;
  mode?: string;
  status?: string;
  result?: string;
  ticker?: string | null;
  direction?: string | null;
  entry_date?: string | null;
  exit_date?: string | null;
  dollar_pl?: number | null;
  r_multiple?: number | null;
  risk_percent?: number | null;
  custom_fields?: Record<string, unknown> | null;
  strategies?: string[];
}): Record<string, unknown> {
  return {
    id: o.id,
    mode: o.mode ?? "trade",
    status: o.status ?? "closed",
    result: o.result ?? "win",
    ticker: o.ticker ?? null,
    direction: o.direction ?? "long",
    entry_date: o.entry_date ?? null,
    exit_date: o.exit_date ?? null,
    dollar_pl: o.dollar_pl ?? null,
    r_multiple: o.r_multiple ?? null,
    risk_percent: o.risk_percent ?? null,
    custom_fields: o.custom_fields ?? null,
    trade_strategies: (o.strategies ?? []).map((name) => ({ strategies: { name } })),
  };
}

// Five closed, realised trades whose stats are hand-computed below, plus one
// still-open and one investment position that every default-closed calculation
// must ignore.
const seed: Seed = {
  trades: [
    trade({ id: "t1", ticker: "AAPL", direction: "long", result: "win",
      dollar_pl: 100, r_multiple: 2, risk_percent: 1,
      entry_date: "2026-01-05T14:00:00Z", exit_date: "2026-01-06T14:00:00Z",
      strategies: ["Breakout"] }),
    trade({ id: "t2", ticker: "AAPL", direction: "long", result: "loss",
      dollar_pl: -50, r_multiple: -1, risk_percent: 1,
      entry_date: "2026-01-07T14:00:00Z", exit_date: "2026-01-08T14:00:00Z",
      strategies: ["Breakout"] }),
    trade({ id: "t3", ticker: "TSLA", direction: "short", result: "win",
      dollar_pl: 200, r_multiple: 3, risk_percent: 2,
      entry_date: "2026-01-09T14:00:00Z", exit_date: "2026-01-12T14:00:00Z",
      strategies: ["Reversal"] }),
    trade({ id: "t4", ticker: "TSLA", direction: "long", result: "loss",
      dollar_pl: -100, r_multiple: -2, risk_percent: 1.5,
      entry_date: "2026-01-13T14:00:00Z", exit_date: "2026-01-14T14:00:00Z" }),
    trade({ id: "t5", ticker: "MSFT", direction: "long", result: "break_even",
      dollar_pl: 0, r_multiple: 0, risk_percent: 0.5,
      entry_date: "2026-01-15T14:00:00Z", exit_date: "2026-01-16T14:00:00Z" }),
    // Excluded from default (closed_only) stats: still open.
    trade({ id: "t6", ticker: "NVDA", direction: "long", status: "open", result: "open",
      dollar_pl: null, r_multiple: null,
      entry_date: "2026-01-17T14:00:00Z", exit_date: null }),
    // Excluded from default stats: investment mode, not a realised trade.
    trade({ id: "t7", ticker: "SPY", direction: "long", mode: "investment", result: "win",
      dollar_pl: 500, r_multiple: 5, risk_percent: 1,
      entry_date: "2025-06-01T14:00:00Z", exit_date: "2026-01-02T14:00:00Z" }),
  ],
  account_transactions: [
    { amount: 1000, note: "initial", created_at: "2026-01-01T00:00:00Z" },
    { amount: 500, note: "top up", created_at: "2026-01-10T00:00:00Z" },
    { amount: -200, note: "withdraw", created_at: "2026-01-20T00:00:00Z" },
  ],
};

function executor() {
  return makeToolExecutor(fakeSupabase(seed), "UTC");
}

async function run(name: string, args: Record<string, unknown>) {
  const call: ToolCall = { id: "c1", name, args };
  return JSON.parse(await executor()(call));
}

describe("compute_stats", () => {
  it("computes exact overall stats over closed, non-investment trades", async () => {
    const r = await run("compute_stats", { group_by: "none" });
    // t1..t5 only: t6 (open) and t7 (investment) are excluded by default.
    expect(r.basis).toBe("closed non-investment trades");
    expect(r.overall.trades).toBe(5);
    expect(r.overall.wins).toBe(2); // +100, +200
    expect(r.overall.losses).toBe(2); // -50, -100
    expect(r.overall.winRate).toBe(0.4); // 2 / 5
    expect(r.overall.totalPL).toBe(150); // 100 - 50 + 200 - 100 + 0
    expect(r.overall.avgPL).toBe(30); // 150 / 5
    expect(r.overall.medianPL).toBe(0); // sorted [-100,-50,0,100,200]
    expect(r.overall.avgR).toBe(0.4); // (2-1+3-2+0)/5
    expect(r.overall.profitFactor).toBe(2); // 300 / 150
    expect(r.overall.expectancyR).toBe(0.4);
  });

  it("groups by direction with exact per-group numbers", async () => {
    const r = await run("compute_stats", { group_by: "direction" });
    const long = r.groups.find((g: { group: string }) => g.group === "long");
    const short = r.groups.find((g: { group: string }) => g.group === "short");

    // long: t1(+100), t2(-50), t4(-100), t5(0)
    expect(long.trades).toBe(4);
    expect(long.totalPL).toBe(-50);
    expect(long.winRate).toBe(0.25); // 1 / 4
    expect(long.profitFactor).toBe(0.667); // 100 / 150
    expect(long.medianPL).toBe(-25); // (-50 + 0) / 2

    // short: t3(+200) only -- no losers, so profit factor is null not Infinity.
    expect(short.trades).toBe(1);
    expect(short.totalPL).toBe(200);
    expect(short.winRate).toBe(1);
    expect(short.profitFactor).toBeNull();
  });

  it("groups by strategy, bucketing untagged trades under (none)", async () => {
    const r = await run("compute_stats", { group_by: "strategy" });
    const breakout = r.groups.find((g: { group: string }) => g.group === "Breakout");
    const none = r.groups.find((g: { group: string }) => g.group === "(none)");
    expect(breakout.trades).toBe(2); // t1, t2
    expect(breakout.totalPL).toBe(50); // 100 - 50
    expect(none.trades).toBe(2); // t4, t5 (untagged)
    expect(none.totalPL).toBe(-100);
  });

  it("includes open and investment positions when closed_only is false", async () => {
    const r = await run("compute_stats", { group_by: "none", closed_only: false });
    expect(r.overall.trades).toBe(7); // all rows
    expect(r.basis).toBe("all matching positions");
  });
});

describe("query_trades", () => {
  it("returns every row when unfiltered", async () => {
    const r = await run("query_trades", {});
    expect(r.totalMatched).toBe(7);
    expect(r.trades).toHaveLength(7);
  });

  it("filters by ticker and sorts, exactly", async () => {
    const r = await run("query_trades", {
      filter: { ticker: "AAPL" },
      sort_by: "dollar_pl",
      sort_dir: "desc",
    });
    expect(r.totalMatched).toBe(2);
    expect(r.trades.map((t: { id: string }) => t.id)).toEqual(["t1", "t2"]);
    expect(r.trades[0].dollar_pl).toBe(100);
  });

  it("filters by direction", async () => {
    const r = await run("query_trades", { filter: { direction: "short" } });
    expect(r.totalMatched).toBe(1);
    expect(r.trades[0].ticker).toBe("TSLA");
  });

  it("filters by a P&L floor", async () => {
    const r = await run("query_trades", { filter: { pl_min: 0.01 } });
    // Only rows with dollar_pl > 0: t1, t3, and t7 (investment is not excluded
    // by query_trades -- only compute_stats defaults to closed_only).
    expect(r.totalMatched).toBe(3);
    expect(r.trades.map((t: { id: string }) => t.id).sort()).toEqual(["t1", "t3", "t7"]);
  });

  it("rejects an unknown filter field via the zod schema", async () => {
    const r = await run("query_trades", { filter: { made_up: "x" } });
    // The executor never throws: a validation failure comes back as data.
    expect(r.error).toBeTruthy();
  });
});

describe("get_trade", () => {
  it("finds one trade by ticker with its strategies", async () => {
    const r = await run("get_trade", { ticker: "AAPL" });
    expect(r.found).toBe(true);
    expect(r.trade.ticker).toBe("AAPL");
    expect(r.trade.strategies).toEqual(["Breakout"]);
    // The raw join column must not leak into the detail payload.
    expect(r.trade.trade_strategies).toBeUndefined();
  });

  it("reports not found for a ticker with no trades", async () => {
    const r = await run("get_trade", { ticker: "GOOG" });
    expect(r.found).toBe(false);
  });
});

describe("get_account", () => {
  it("computes the cash ledger and estimated balance exactly", async () => {
    const r = await run("get_account", {});
    expect(r.deposits).toBe(1500); // 1000 + 500
    expect(r.withdrawals).toBe(-200);
    expect(r.netDeposits).toBe(1300);
    expect(r.realisedPL).toBe(150); // closed non-investment P&L, matching overall totalPL
    expect(r.estimatedBalance).toBe(1450); // 1300 + 150
    expect(r.transactionCount).toBe(3);
  });
});

describe("an unknown tool", () => {
  it("comes back as a readable error, not a thrown exception", async () => {
    const r = await run("delete_everything", {});
    expect(r.error).toMatch(/unknown tool/i);
  });
});

describe("TOOL_DEFS", () => {
  it("exposes exactly the four read-only tools, each with an object schema", () => {
    expect(TOOL_DEFS.map((t) => t.name).sort()).toEqual([
      "compute_stats",
      "get_account",
      "get_trade",
      "query_trades",
    ]);
    for (const def of TOOL_DEFS) {
      expect(def.parameters.type).toBe("object");
      expect(typeof def.description).toBe("string");
    }
  });
});
