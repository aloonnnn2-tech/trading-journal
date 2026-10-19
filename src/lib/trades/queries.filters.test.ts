import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listFilteredClosedTrades, listTradesPage, type TradeListFilters } from "./queries";

// The summary strip must describe exactly the trades the table is filtered
// to (Phase 4B). Both queries go through one filter function; this pins that
// they send the same filters, and that the strip adds only its "closed"
// definition on top -- getAnalyticsSummary's, so unfiltered they agree.

type Call = [string, ...unknown[]];

/** A stand-in PostgREST builder that records every call and resolves empty. */
function recordingClient() {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "gte", "lt", "lte", "or", "not", "contains", "order", "range"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null, count: 0 });
  const client = {
    from: (table: string) => {
      calls.push(["from", table]);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const FILTERS: TradeListFilters = {
  search: "NVDA",
  status: "closed",
  folderId: "f1",
  strategyId: "s1",
  market: "US",
  emotion: "Calm",
  direction: "long",
  plMin: -500,
  plMax: 900,
  riskMin: 0.5,
  riskMax: 2,
  customField: { key: "setup", value: "A+" },
};

/** The filter calls only -- not the select, sort, paging, or the strip's closed set. */
const filterCalls = (calls: Call[]) => calls.filter(([m]) => !["from", "select", "order", "range"].includes(m));

describe("the trade list and its summary strip", () => {
  it("apply the same filters", async () => {
    const list = recordingClient();
    await listTradesPage(list.client, { ...FILTERS, page: 2, pageSize: 50 });

    const strip = recordingClient();
    await listFilteredClosedTrades(strip.client, FILTERS);

    const stripOwn: Call[] = [
      ["eq", "status", "closed"],
      ["not", "exit_date", "is", null],
      ["neq", "mode", "investment"],
    ];
    const stripFilters = filterCalls(strip.calls);
    expect(stripFilters.slice(-stripOwn.length)).toEqual(stripOwn);
    expect(stripFilters.slice(0, -stripOwn.length)).toEqual(filterCalls(list.calls));
  });

  it("join the same folder and strategy tables", async () => {
    const list = recordingClient();
    await listTradesPage(list.client, FILTERS);
    const strip = recordingClient();
    await listFilteredClosedTrades(strip.client, FILTERS);

    const embeds = (calls: Call[]) => String(calls.find(([m]) => m === "select")?.[1]).split(", ").slice(-2);
    expect(embeds(strip.calls)).toEqual(embeds(list.calls));
    expect(embeds(list.calls)).toEqual(["trade_folders!inner(folder_id)", "trade_strategies!inner(strategy_id)"]);
  });

  it("the strip ignores page and sort, reading every page in exit order", async () => {
    const strip = recordingClient();
    await listFilteredClosedTrades(strip.client, { ...FILTERS, page: 3, sortBy: "ticker", sortDir: "asc" });
    expect(strip.calls.filter(([m]) => m === "order")).toEqual([
      ["order", "exit_date", { ascending: true }],
      ["order", "id", { ascending: true }],
    ]);
    expect(strip.calls.find(([m]) => m === "range")).toEqual(["range", 0, 999]);
  });
});

// The emotion filter is the second place user text goes into or()'s filter
// SYNTAX (an emotion tag is free text typed on the Emotions page). PostgREST
// splits or() on commas and groups on parentheses before binding any value,
// so a tag must arrive as one quoted literal per condition -- never as extra
// conditions. Split the way PostgREST does: commas outside double quotes,
// honouring backslash escapes inside them.
function splitOrConditions(filter: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < filter.length; i++) {
    const ch = filter[i];
    if (quoted && ch === "\\") {
      current += ch + filter[++i];
      continue;
    }
    if (ch === '"') quoted = !quoted;
    if (ch === "," && !quoted) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/** The quoted value of one condition, unescaped. */
function literalOf(condition: string): string {
  const match = /\.cs\."(.*)"$/.exec(condition);
  if (!match) throw new Error(`not a single quoted literal: ${condition}`);
  return match[1].replace(/\\(.)/g, "$1");
}

describe("the emotion filter with hostile tags", () => {
  const PAYLOADS = [
    "a,b.eq.c",
    "'; drop table trades--",
    'say "hi"',
    "back\\slash",
    "x),or(user_id.neq.0",
    "calm,status.eq.open",
  ];

  for (const emotion of PAYLOADS) {
    it(`keeps ${JSON.stringify(emotion)} as one literal per slot`, async () => {
      const { client, calls } = recordingClient();
      await listTradesPage(client, { emotion, page: 1, pageSize: 50 });
      const or = calls.find(([m]) => m === "or");
      expect(or).toBeDefined();
      const conditions = splitOrConditions(or![1] as string);
      // Three slots (before / during / after), never more.
      expect(conditions).toHaveLength(3);
      for (const condition of conditions) {
        expect(condition).toMatch(/^custom_fields->emotion_(before|during|after)\.cs\."/);
        expect(JSON.parse(literalOf(condition))).toEqual([emotion]);
      }
    });
  }
});
