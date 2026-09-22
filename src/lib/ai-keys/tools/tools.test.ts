import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeToolExecutor, TOOL_DEFS, toolDefsFor, TradeStore } from "./index";
import { resolveChoice } from "./reports";
import { tierPolicyFor } from "../tier";

// The tools are the source of the exact numbers the chat quotes, so they are
// pinned against a hand-computed seed. The fake honours eq/in/neq/not so
// helpers that filter server-side (getAccountBalance) see the right rows, and
// answers every unseeded table with an empty list so the new tools that touch
// strategies, fields, folders, rules, history and images degrade to "none".

type Row = Record<string, unknown>;
type Seed = Record<string, Row[]>;

function fakeSupabase(seed: Seed): SupabaseClient {
  const client = {
    from(table: string) {
      const source = seed[table] ?? [];
      const filters: ((r: Row) => boolean)[] = [];
      const apply = () => source.filter((r) => filters.every((f) => f(r)));
      const builder: Record<string, unknown> = {
        select: () => builder,
        order: () => builder,
        limit: () => builder,
        eq: (k: string, v: unknown) => {
          filters.push((r) => r[k] === v);
          return builder;
        },
        neq: (k: string, v: unknown) => {
          filters.push((r) => r[k] !== v);
          return builder;
        },
        in: (k: string, vs: unknown[]) => {
          filters.push((r) => vs.includes(r[k]));
          return builder;
        },
        is: (k: string, v: unknown) => {
          filters.push((r) => (v === null ? r[k] == null : r[k] === v));
          return builder;
        },
        not: (k: string, op: string, v: unknown) => {
          if (op === "is" && v === null) filters.push((r) => r[k] != null);
          return builder;
        },
        maybeSingle: () => Promise.resolve({ data: apply()[0] ?? null, error: null }),
        single: () => Promise.resolve({ data: apply()[0] ?? null, error: null }),
        range: () => Promise.resolve({ data: apply(), error: null }),
        then: (resolve: (v: { data: unknown; error: null }) => unknown) => resolve({ data: apply(), error: null }),
      };
      return builder;
    },
  };
  return client as unknown as SupabaseClient;
}

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
  strategies?: { id: string; name: string }[];
}): Row {
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
    stop_loss: null,
    take_profit: null,
    custom_fields: o.custom_fields ?? null,
    strategy_field_values: null,
    updated_at: "2026-01-10T00:00:00Z",
    trade_strategies: (o.strategies ?? []).map((s) => ({ strategies: s })),
  };
}

const BREAKOUT = { id: "s-breakout", name: "Breakout" };

// Five closed, realised trades whose stats are hand-computed below, plus one
// still-open and one investment position that every default-closed calculation
// must ignore.
const seed: Seed = {
  trades: [
    trade({ id: "t1", ticker: "AAPL", direction: "long", result: "win", dollar_pl: 100, r_multiple: 2, risk_percent: 1, entry_date: "2026-01-05T14:00:00Z", exit_date: "2026-01-06T14:00:00Z", strategies: [BREAKOUT] }),
    trade({ id: "t2", ticker: "AAPL", direction: "long", result: "loss", dollar_pl: -50, r_multiple: -1, risk_percent: 1, entry_date: "2026-01-07T14:00:00Z", exit_date: "2026-01-07T18:00:00Z", strategies: [BREAKOUT] }),
    trade({ id: "t3", ticker: "MSFT", direction: "long", result: "win", dollar_pl: 200, r_multiple: 4, risk_percent: 0.5, entry_date: "2026-01-08T14:00:00Z", exit_date: "2026-01-12T14:00:00Z", custom_fields: { emotion_before: ["calm"] } }),
    trade({ id: "t4", ticker: "TSLA", direction: "short", result: "loss", dollar_pl: -100, r_multiple: -1, risk_percent: 2, entry_date: "2026-02-02T14:00:00Z", exit_date: "2026-02-03T14:00:00Z" }),
    trade({ id: "t5", ticker: "NVDA", direction: "long", result: "break_even", dollar_pl: 0, r_multiple: 0, risk_percent: 1, entry_date: "2026-02-05T14:00:00Z", exit_date: "2026-02-05T15:00:00Z" }),
    trade({ id: "t6", ticker: "AMD", status: "open", result: "open", dollar_pl: null, entry_date: "2026-02-10T14:00:00Z" }),
    trade({ id: "t7", ticker: "VTI", mode: "investment", dollar_pl: 999, r_multiple: null, entry_date: "2025-06-01T14:00:00Z", exit_date: "2026-01-20T14:00:00Z" }),
  ],
  account_transactions: [
    { id: "a1", amount: 1000, note: "initial", created_at: "2026-01-01T00:00:00Z" },
    { id: "a2", amount: -200, note: "withdrawal", created_at: "2026-01-15T00:00:00Z" },
    { id: "a3", amount: 500, note: null, created_at: "2026-02-01T00:00:00Z" },
  ],
  strategies: [{ id: BREAKOUT.id, name: BREAKOUT.name, description: "Range break with volume", color: null, sort_order: 0 }],
  field_definitions: [
    { id: "f1", entity_type: "trade", key: "notes_why_entered", label: "Why I entered", field_type: "large_notes", options: {}, sort_order: 0, is_default: true, strategy_id: null },
    { id: "f2", entity_type: "trade", key: "emotion_before", label: "Emotion before", field_type: "tags", options: { choices: ["calm", "fomo"] }, sort_order: 1, is_default: true, strategy_id: null },
  ],
};

function run(name: string, args: Record<string, unknown>, s: Seed = seed) {
  const sb = fakeSupabase(s);
  const exec = makeToolExecutor(sb, "UTC", new TradeStore(sb, "UTC"));
  return exec({ id: "c", name, args }).then((out) => JSON.parse(out));
}

describe("compute_stats", () => {
  it("computes exact overall stats over closed, non-investment trades", async () => {
    const r = await run("compute_stats", {});
    // t1..t5: P&L 100, -50, 200, -100, 0 → total 150; 2 wins, 2 losses
    expect(r.overall.trades).toBe(5);
    expect(r.overall.wins).toBe(2);
    expect(r.overall.losses).toBe(2);
    expect(r.overall.winRate).toBe(0.4);
    expect(r.overall.totalPL).toBe(150);
    expect(r.overall.avgPL).toBe(30);
    expect(r.overall.medianPL).toBe(0);
    expect(r.overall.avgWin).toBe(150); // (100+200)/2
    expect(r.overall.avgLoss).toBe(-75); // (-50-100)/2
    expect(r.overall.largestWin).toBe(200);
    expect(r.overall.largestLoss).toBe(-100);
    expect(r.overall.profitFactor).toBe(2); // 300 / 150
    expect(r.overall.avgR).toBe(0.8); // (2-1+4-1+0)/5
  });

  it("groups by direction with exact per-group numbers", async () => {
    const r = await run("compute_stats", { group_by: "direction" });
    const long = r.groups.find((g: { group: string }) => g.group === "long");
    const short = r.groups.find((g: { group: string }) => g.group === "short");
    expect(long.trades).toBe(4);
    expect(long.totalPL).toBe(250);
    expect(short.trades).toBe(1);
    expect(short.totalPL).toBe(-100);
    expect(r.truncated).toBe(false);
  });

  it("groups by strategy, bucketing untagged trades under (none)", async () => {
    const r = await run("compute_stats", { group_by: "strategy" });
    const groups = Object.fromEntries(r.groups.map((g: { group: string; trades: number }) => [g.group, g.trades]));
    expect(groups.Breakout).toBe(2);
    expect(groups["(none)"]).toBe(3);
  });

  it("buckets hour_of_day in the TRADER's timezone, not the server's", async () => {
    // Both AAPL trades ENTERED at 14:00 UTC (grouping is by entry hour), so
    // one bucket -- and in Tokyo that same instant is 23:00.
    const utc = await run("compute_stats", { group_by: "hour_of_day", filter: { ticker: "AAPL" } }, seed);
    const sbTokyo = fakeSupabase(seed);
    const tokyo = JSON.parse(
      await makeToolExecutor(sbTokyo, "Asia/Tokyo", new TradeStore(sbTokyo, "Asia/Tokyo"))({
        id: "c",
        name: "compute_stats",
        args: { group_by: "hour_of_day", filter: { ticker: "AAPL" } },
      }),
    );
    expect(utc.groups.map((g: { group: string }) => g.group)).toEqual(["14:00"]);
    expect(tokyo.groups.map((g: { group: string }) => g.group)).toEqual(["23:00"]);
  });

  it("includes open and investment positions when closed_only is false", async () => {
    const r = await run("compute_stats", { closed_only: false });
    expect(r.overall.trades).toBe(7);
  });
});

describe("query_trades", () => {
  it("returns every row in the envelope when unfiltered", async () => {
    const r = await run("query_trades", {});
    expect(r.total).toBe(7);
    expect(r.returned).toBe(7);
    expect(r.truncated).toBe(false);
  });

  it("pages with limit and offset and reports truncation honestly", async () => {
    const first = await run("query_trades", { limit: 3, sort_by: "entry_date", sort_dir: "asc" });
    expect(first.returned).toBe(3);
    expect(first.total).toBe(7);
    expect(first.truncated).toBe(true);
    const second = await run("query_trades", { limit: 3, offset: 3, sort_by: "entry_date", sort_dir: "asc" });
    expect(second.items.map((t: { id: string }) => t.id)).not.toEqual(first.items.map((t: { id: string }) => t.id));
    expect(second.offset).toBe(3);
  });

  it("filters by ticker and sorts, exactly", async () => {
    const r = await run("query_trades", { filter: { ticker: "AAPL" }, sort_by: "dollar_pl", sort_dir: "desc" });
    expect(r.total).toBe(2);
    expect(r.items.map((t: { id: string }) => t.id)).toEqual(["t1", "t2"]);
    expect(r.items[0].dollar_pl).toBe(100);
  });

  it("include: notes renders custom fields under the user's own labels", async () => {
    const r = await run("query_trades", { filter: { ticker: "MSFT" }, include: "notes" });
    expect(r.items[0].fields).toEqual({ "Emotion before": "calm" });
  });

  it("rejects an unknown filter field via the zod schema", async () => {
    const r = await run("query_trades", { filter: { made_up: "x" } });
    expect(r.error).toBeTruthy();
  });
});

describe("get_trade", () => {
  it("finds one trade by ticker with its strategies and labelled fields", async () => {
    const r = await run("get_trade", { ticker: "MSFT" });
    expect(r.found).toBe(true);
    expect(r.trade.ticker).toBe("MSFT");
    expect(r.trade.fields).toEqual({ "Emotion before": "calm" });
    expect(r.edits).toEqual({ count: 0, stopMoved: false, targetMoved: false, historyMayBeTruncated: false });
  });

  it("never leaks housekeeping columns or raw join data", async () => {
    const r = await run("get_trade", { ticker: "AAPL" });
    const text = JSON.stringify(r);
    for (const forbidden of ["user_id", "dismissed_suggestions", "commission_manual", "trade_strategies", "strategy_field_values"]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
    expect(r.trade.strategies).toEqual(["Breakout"]);
  });

  it("reports not found for a ticker with no trades", async () => {
    const r = await run("get_trade", { ticker: "GOOG" });
    expect(r.found).toBe(false);
  });
});

describe("get_account", () => {
  it("uses the shared balance helper: deposits, realised P&L, balance", async () => {
    const r = await run("get_account", {});
    expect(r.deposited).toBe(1300); // 1000 - 200 + 500
    // getAccountBalance sums dollar_pl over ALL closed trades incl. the
    // investment (999), matching the dashboard's definition.
    expect(r.realisedPL).toBe(1149);
    expect(r.balance).toBe(2449);
    expect(r.hasTransactions).toBe(true);
    expect(r.recentTransactions).toHaveLength(3);
  });
});

describe("setup tools", () => {
  it("list_strategies returns each strategy with its rules", async () => {
    const r = await run("list_strategies", {});
    expect(r.items[0].name).toBe("Breakout");
    expect(r.items[0].rules).toEqual([]);
  });

  it("list_custom_fields exposes labels, keys, types and choices", async () => {
    const r = await run("list_custom_fields", {});
    expect(r.trade_fields.find((f: { key: string }) => f.key === "emotion_before")).toMatchObject({
      label: "Emotion before",
      type: "tags",
      choices: ["calm", "fomo"],
    });
  });

  it("get_settings returns the timezone and TODAY's real date", async () => {
    const r = await run("get_settings", {});
    expect(r.timezone).toBe("UTC");
    // Compared to the actual date, not just the shape: localDateParts has a
    // 0-indexed month and the first version of this tool was a month behind.
    expect(r.today).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe("an unknown tool", () => {
  it("comes back as a readable error, not a thrown exception", async () => {
    const r = await run("delete_everything", {});
    expect(r.error).toMatch(/unknown tool/i);
  });
});

describe("tool definitions", () => {
  it("full set exposes all thirteen read tools with object schemas", () => {
    expect(TOOL_DEFS.map((t) => t.name).sort()).toEqual([
      "compute_stats",
      "get_account",
      "get_period_report",
      "get_report",
      "get_reviews",
      "get_settings",
      "get_trade",
      "get_trade_history",
      "list_commission_rules",
      "list_custom_fields",
      "list_folders",
      "list_strategies",
      "query_trades",
    ]);
    for (const def of TOOL_DEFS) {
      expect(def.parameters.type).toBe("object");
      expect(typeof def.description).toBe("string");
    }
  });

  it("the free-tier compact set stays small enough for an 8k-token-per-minute budget", () => {
    const compact = toolDefsFor(tierPolicyFor("groq"));
    const full = toolDefsFor(tierPolicyFor("openai"));
    expect(compact.length).toBeLessThan(full.length);
    // Roughly 4 chars per token: 5 000 chars ≈ 1 250 tokens, sent every turn.
    expect(JSON.stringify(compact).length).toBeLessThan(5_000);
    // Every compact tool is a real tool.
    const names = new Set(full.map((t) => t.name));
    for (const t of compact) expect(names.has(t.name)).toBe(true);
  });
});

describe("get_period_report periods", () => {
  // The review resolver's "monthly" is the PREVIOUS month on purpose. The
  // chat's this_month must be the current one -- asked on the 20th, "how is
  // this month going" is about the month we're in. Tested on the pure
  // resolver: the full report needs a real database.
  const y = new Date().getUTCFullYear();
  const m = new Date().getUTCMonth() + 1;
  const mm = String(m).padStart(2, "0");

  it("this_month covers the current month to date", () => {
    const p = resolveChoice("this_month", "UTC")!;
    expect(p.startDate).toBe(`${y}-${mm}-01`);
    expect(p.endDate.slice(0, 7)).toBe(`${y}-${mm}`);
  });

  it("last_month is the previous complete month", () => {
    const p = resolveChoice("last_month", "UTC")!;
    const pm = m === 1 ? 12 : m - 1;
    const py = m === 1 ? y - 1 : y;
    expect(p.startDate).toBe(`${py}-${String(pm).padStart(2, "0")}-01`);
    expect(p.endDate.slice(0, 7)).toBe(`${py}-${String(pm).padStart(2, "0")}`);
  });

  it("this_week starts on Monday; last_week is the previous Monday to Sunday", () => {
    const cur = resolveChoice("this_week", "UTC")!;
    expect(new Date(`${cur.startDate}T00:00:00Z`).getUTCDay()).toBe(1);
    const prev = resolveChoice("last_week", "UTC")!;
    expect(new Date(`${prev.startDate}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(new Date(`${prev.endDate}T00:00:00Z`).getUTCDay()).toBe(0);
    expect(prev.endDate < cur.startDate).toBe(true);
  });

  it("custom needs both dates", async () => {
    expect(resolveChoice("custom", "UTC", { start: "2026-01-01" })).toBeNull();
    const r = await run("get_period_report", { period: "custom", start: "2026-01-01" });
    expect(r.error).toMatch(/start and end/);
  });
});

describe("get_period_report comparison periods", () => {
  it("this_month compares against the whole previous month, not the same number of days", () => {
    // Pure check of the two resolvers the tool pairs up.
    const cur = resolveChoice("this_month", "UTC")!;
    const prev = resolveChoice("last_month", "UTC")!;
    expect(prev.startDate.endsWith("-01")).toBe(true);
    // prev ends the day before cur starts.
    const dayBefore = new Date(new Date(`${cur.startDate}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
    expect(prev.endDate).toBe(dayBefore);
  });
});

describe("get_trade ambiguity", () => {
  it("says when other trades of the ticker also match, and which one it picked", async () => {
    // Two AAPL trades; no date. The newest is returned, and the model is told
    // there is another so it does not present one of two as the one asked for.
    const r = await run("get_trade", { ticker: "AAPL" });
    expect(r.found).toBe(true);
    expect(r.otherMatches).toBe(1);
    expect(r.note).toMatch(/1 other AAPL trade/);
  });

  it("picks the trade on the given date and is quiet when that settles it", async () => {
    const r = await run("get_trade", { ticker: "AAPL", date: "2026-01-07" });
    expect(r.trade.id).toBe("t2");
    expect(r.otherMatches).toBeUndefined();
  });

  it("falls back to the newest and says the date matched nothing", async () => {
    const r = await run("get_trade", { ticker: "AAPL", date: "2025-03-03" });
    expect(r.found).toBe(true);
    expect(r.note).toMatch(/no AAPL trade on 2025-03-03/);
  });
});

describe("filter dates", () => {
  it("rejects a date that is not YYYY-MM-DD instead of silently matching nothing", async () => {
    const r = await run("query_trades", { filter: { date_from: "last monday" } });
    expect(r.error).toMatch(/YYYY-MM-DD/);
  });

  it("accepts a full timestamp and compares on its date", async () => {
    const r = await run("query_trades", { filter: { date_from: "2026-02-01T00:00:00Z" } });
    expect(r.items.map((t: { id: string }) => t.id).sort()).toEqual(["t4", "t5", "t6"]);
  });
});

describe("output budget", () => {
  it("cuts a page down to fit the tier ceiling rather than refusing it", async () => {
    const sb = fakeSupabase(seed);
    const exec = makeToolExecutor(sb, "UTC", new TradeStore(sb, "UTC"), 700);
    const r = JSON.parse(await exec({ id: "c", name: "query_trades", args: {} }));
    expect(r.error).toBeUndefined();
    expect(r.returned).toBeLessThan(7);
    expect(r.total).toBe(7);
    expect(r.truncated).toBe(true);
    expect(r.hint).toMatch(/cut/);
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(700);
  });

  it("still refuses a single unpageable result that is too large", async () => {
    const sb = fakeSupabase(seed);
    const exec = makeToolExecutor(sb, "UTC", new TradeStore(sb, "UTC"), 120);
    const r = JSON.parse(await exec({ id: "c", name: "get_trade", args: { ticker: "MSFT" } }));
    expect(r.error).toBe("result too large");
  });
});
