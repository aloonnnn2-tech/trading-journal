import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { getLocalDayName } from "@/lib/dates/day-of-week";
import type { ToolCall, ToolDef } from "./providers/types";

// The read-only tools the Ask chatbot can call to reach the trader's own data
// and get EXACT numbers computed here rather than guessed from a text dump.
//
// Every executor runs on the RLS-scoped client the route hands in, so a tool
// can only ever read the asking user's own rows -- the same guarantee the
// text-context builder relies on. Nothing here writes. There is deliberately
// no free-form query tool: the model chooses from a fixed, validated surface,
// so a prompt-injected instruction inside a trade note can at worst waste a
// call, never reach another user or mutate anything.

const MAX_ROWS_OUT = 50;
const MAX_GROUPS_OUT = 40;
const MAX_TXNS_OUT = 100;

// ---- shared filter -------------------------------------------------------

const filterSchema = z
  .object({
    ticker: z.string().max(40).optional(),
    direction: z.enum(["long", "short"]).optional(),
    status: z.enum(["pending", "open", "closed", "expired"]).optional(),
    result: z.enum(["open", "win", "loss", "break_even"]).optional(),
    mode: z.enum(["trade", "investment"]).optional(),
    strategy: z.string().max(120).optional(),
    date_from: z.string().max(40).optional(),
    date_to: z.string().max(40).optional(),
    pl_min: z.number().optional(),
    pl_max: z.number().optional(),
    r_min: z.number().optional(),
    r_max: z.number().optional(),
    risk_max: z.number().optional(),
    custom_field: z.object({ key: z.string().max(120), value: z.string().max(200) }).optional(),
  })
  .strict()
  .optional();

type Filter = z.infer<typeof filterSchema>;

interface Row {
  [k: string]: unknown;
  id: string;
  mode: string;
  status: string;
  result: string;
  ticker: string | null;
  direction: string | null;
  entry_date: string | null;
  exit_date: string | null;
  dollar_pl: number | null;
  r_multiple: number | null;
  risk_percent: number | null;
  custom_fields: Record<string, unknown> | null;
  trade_strategies?: { strategies: { name: string } | { name: string }[] | null }[];
}

function strategyNames(t: Row): string[] {
  return (t.trade_strategies ?? [])
    .flatMap((l) => (Array.isArray(l.strategies) ? l.strategies : [l.strategies]))
    .map((s) => s?.name)
    .filter((n): n is string => typeof n === "string");
}

function dateOnly(v: unknown): string | null {
  return typeof v === "string" ? v.slice(0, 10) : null;
}

function matchesFilter(t: Row, f: Filter): boolean {
  if (!f) return true;
  if (f.ticker && (t.ticker ?? "").toUpperCase() !== f.ticker.toUpperCase()) return false;
  if (f.direction && t.direction !== f.direction) return false;
  if (f.status && t.status !== f.status) return false;
  if (f.result && t.result !== f.result) return false;
  if (f.mode && t.mode !== f.mode) return false;
  if (f.strategy) {
    const names = strategyNames(t).map((n) => n.toLowerCase());
    if (!names.includes(f.strategy.toLowerCase())) return false;
  }
  const ref = dateOnly(t.exit_date) ?? dateOnly(t.entry_date);
  if (f.date_from && (!ref || ref < f.date_from.slice(0, 10))) return false;
  if (f.date_to && (!ref || ref > f.date_to.slice(0, 10))) return false;
  if (f.pl_min != null && !(typeof t.dollar_pl === "number" && t.dollar_pl >= f.pl_min)) return false;
  if (f.pl_max != null && !(typeof t.dollar_pl === "number" && t.dollar_pl <= f.pl_max)) return false;
  if (f.r_min != null && !(typeof t.r_multiple === "number" && t.r_multiple >= f.r_min)) return false;
  if (f.r_max != null && !(typeof t.r_multiple === "number" && t.r_multiple <= f.r_max)) return false;
  if (f.risk_max != null && !(typeof t.risk_percent === "number" && t.risk_percent <= f.risk_max)) return false;
  if (f.custom_field) {
    const raw = (t.custom_fields ?? {})[f.custom_field.key];
    const hay = Array.isArray(raw) ? raw.map(String) : [String(raw ?? "")];
    if (!hay.some((v) => v.toLowerCase().includes(f.custom_field!.value.toLowerCase()))) return false;
  }
  return true;
}

async function loadTrades(supabase: SupabaseClient): Promise<Row[]> {
  return fetchAllRows<Row>((from, to) =>
    supabase
      .from("trades")
      .select("*, trade_strategies(strategies(name))")
      .order("entry_date", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .range(from, to),
  );
}

// ---- grouping / stats ----------------------------------------------------

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function round(n: number | null, d = 2): number | null {
  if (n == null || Number.isNaN(n) || !Number.isFinite(n)) return null;
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

interface StatBlock {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalPL: number;
  avgPL: number | null;
  medianPL: number | null;
  avgR: number | null;
  profitFactor: number | null;
  expectancyR: number | null;
}

function computeBlock(rows: Row[]): StatBlock {
  const pls = rows.map((r) => (typeof r.dollar_pl === "number" ? r.dollar_pl : 0));
  const wins = rows.filter((r) => (r.dollar_pl ?? 0) > 0).length;
  const losses = rows.filter((r) => (r.dollar_pl ?? 0) < 0).length;
  const grossWin = pls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(pls.filter((p) => p < 0).reduce((a, b) => a + b, 0));
  const rs = rows.map((r) => r.r_multiple).filter((r): r is number => typeof r === "number");
  const total = pls.reduce((a, b) => a + b, 0);
  const avgR = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
  return {
    trades: rows.length,
    wins,
    losses,
    winRate: rows.length ? round(wins / rows.length, 4) : null,
    totalPL: round(total) ?? 0,
    avgPL: rows.length ? round(total / rows.length) : null,
    medianPL: round(median(pls)),
    avgR: round(avgR, 3),
    // Undefined profit factor (no losing trades) is reported as null rather
    // than Infinity, which serialises to null in JSON anyway and reads wrong.
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 3) : null,
    expectancyR: round(avgR, 3),
  };
}

function holdBucket(t: Row): string {
  const a = dateOnly(t.entry_date);
  const b = dateOnly(t.exit_date);
  if (!a || !b) return "unknown";
  const days = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
  if (days <= 0) return "intraday";
  if (days === 1) return "1 day";
  if (days <= 5) return "2-5 days";
  if (days <= 20) return "1-4 weeks";
  return "over a month";
}

function riskBucket(t: Row): string {
  const r = t.risk_percent;
  if (typeof r !== "number") return "unrecorded";
  if (r < 0.5) return "under 0.5%";
  if (r < 1) return "0.5-1%";
  if (r < 2) return "1-2%";
  return "2%+";
}

function groupKeys(t: Row, by: string, tz: string | null): string[] {
  switch (by) {
    case "day_of_week":
      return t.exit_date ? [getLocalDayName(t.exit_date, tz)] : ["unknown"];
    case "month":
      return [dateOnly(t.exit_date ?? t.entry_date)?.slice(0, 7) ?? "unknown"];
    case "hour_of_day":
      return t.entry_date ? [`${new Date(t.entry_date).getHours()}:00`] : ["unknown"];
    case "ticker":
      return [t.ticker ?? "unknown"];
    case "direction":
      return [t.direction ?? "unknown"];
    case "result":
      return [t.result ?? "unknown"];
    case "strategy": {
      const n = strategyNames(t);
      return n.length ? n : ["(none)"];
    }
    case "emotion_before": {
      const e = (t.custom_fields ?? {}).emotion_before;
      const arr = Array.isArray(e) ? e.map(String) : e ? [String(e)] : [];
      return arr.length ? arr : ["(none)"];
    }
    case "risk_bucket":
      return [riskBucket(t)];
    case "hold_bucket":
      return [holdBucket(t)];
    default:
      return ["all"];
  }
}

// ---- executors -----------------------------------------------------------

const queryTradesSchema = z
  .object({
    filter: filterSchema,
    sort_by: z.enum(["entry_date", "exit_date", "dollar_pl", "r_multiple", "risk_percent"]).optional(),
    sort_dir: z.enum(["asc", "desc"]).optional(),
    limit: z.number().int().min(1).max(MAX_ROWS_OUT).optional(),
  })
  .strict();

const computeStatsSchema = z
  .object({
    filter: filterSchema,
    group_by: z
      .enum([
        "none",
        "day_of_week",
        "month",
        "hour_of_day",
        "ticker",
        "direction",
        "result",
        "strategy",
        "emotion_before",
        "risk_bucket",
        "hold_bucket",
      ])
      .optional(),
    closed_only: z.boolean().optional(),
  })
  .strict();

const getTradeSchema = z
  .object({
    id: z.string().uuid().optional(),
    ticker: z.string().max(40).optional(),
    date: z.string().max(40).optional(),
  })
  .strict();

function compactRow(t: Row): Record<string, unknown> {
  const out: Record<string, unknown> = { id: t.id, ticker: t.ticker, status: t.status };
  if (t.mode === "investment") out.mode = "investment";
  for (const k of [
    "direction",
    "result",
    "entry_date",
    "exit_date",
    "entry_price",
    "exit_price",
    "shares",
    "dollar_pl",
    "r_multiple",
    "risk_percent",
  ]) {
    const v = t[k];
    if (v != null) out[k] = k.endsWith("_date") ? dateOnly(v) : v;
  }
  const strat = strategyNames(t);
  if (strat.length) out.strategies = strat;
  return out;
}

async function queryTrades(supabase: SupabaseClient, args: z.infer<typeof queryTradesSchema>) {
  const all = await loadTrades(supabase);
  const rows = all.filter((t) => matchesFilter(t, args.filter));
  const totalMatched = rows.length;
  const by = args.sort_by ?? "exit_date";
  const dir = args.sort_dir ?? "desc";
  rows.sort((a, b) => {
    const av = a[by];
    const bv = b[by];
    const an = typeof av === "number" ? av : av ? new Date(String(av)).getTime() : -Infinity;
    const bn = typeof bv === "number" ? bv : bv ? new Date(String(bv)).getTime() : -Infinity;
    return dir === "asc" ? an - bn : bn - an;
  });
  const limit = args.limit ?? 20;
  return {
    totalMatched,
    returned: Math.min(limit, rows.length),
    trades: rows.slice(0, limit).map(compactRow),
  };
}

async function computeStats(
  supabase: SupabaseClient,
  args: z.infer<typeof computeStatsSchema>,
  tz: string | null,
) {
  const all = await loadTrades(supabase);
  const closedOnly = args.closed_only ?? true;
  const rows = all.filter((t) => {
    if (closedOnly && (t.mode === "investment" || t.status !== "closed")) return false;
    return matchesFilter(t, args.filter);
  });
  const basis = closedOnly ? "closed non-investment trades" : "all matching positions";
  const by = args.group_by ?? "none";
  const overall = computeBlock(rows);
  if (by === "none") return { basis, overall };

  const groups = new Map<string, Row[]>();
  for (const t of rows) {
    for (const k of groupKeys(t, by, tz)) {
      const arr = groups.get(k);
      if (arr) arr.push(t);
      else groups.set(k, [t]);
    }
  }
  let entries = Array.from(groups.entries()).map(([group, rs]) => ({ group, ...computeBlock(rs) }));
  entries.sort((a, b) => b.trades - a.trades);
  const truncated = entries.length > MAX_GROUPS_OUT;
  entries = entries.slice(0, MAX_GROUPS_OUT);
  return {
    basis,
    group_by: by,
    overall,
    groups: entries,
    ...(truncated ? { note: `only the ${MAX_GROUPS_OUT} largest groups are shown` } : {}),
  };
}

async function getTrade(supabase: SupabaseClient, args: z.infer<typeof getTradeSchema>) {
  const all = await loadTrades(supabase);
  let match: Row | undefined;
  if (args.id) {
    match = all.find((t) => t.id === args.id);
  } else if (args.ticker) {
    const cands = all.filter((t) => (t.ticker ?? "").toUpperCase() === args.ticker!.toUpperCase());
    match = args.date
      ? cands.find((t) => (dateOnly(t.exit_date) ?? dateOnly(t.entry_date)) === args.date!.slice(0, 10)) ??
        cands[0]
      : cands[0];
  }
  if (!match) return { found: false };
  const { trade_strategies: _ts, ...rest } = match;
  void _ts;
  return { found: true, trade: { ...rest, strategies: strategyNames(match) } };
}

async function getAccount(supabase: SupabaseClient) {
  const [{ data: txns }, all] = await Promise.all([
    supabase.from("account_transactions").select("amount, note, created_at").order("created_at"),
    loadTrades(supabase),
  ]);
  const list = txns ?? [];
  const deposits = list.filter((t) => Number(t.amount) > 0).reduce((a, t) => a + Number(t.amount), 0);
  const withdrawals = list.filter((t) => Number(t.amount) < 0).reduce((a, t) => a + Number(t.amount), 0);
  const net = deposits + withdrawals;
  const realisedPL = all
    .filter((t) => t.mode !== "investment" && t.status === "closed")
    .reduce((a, t) => a + (typeof t.dollar_pl === "number" ? t.dollar_pl : 0), 0);
  return {
    netDeposits: round(net) ?? 0,
    deposits: round(deposits) ?? 0,
    withdrawals: round(withdrawals) ?? 0,
    realisedPL: round(realisedPL) ?? 0,
    estimatedBalance: round(net + realisedPL) ?? 0,
    transactionCount: list.length,
    transactions: list.slice(-MAX_TXNS_OUT).map((t) => ({
      date: dateOnly(t.created_at),
      amount: round(Number(t.amount)) ?? 0,
      note: t.note ?? null,
    })),
  };
}

// ---- neutral definitions handed to the model -----------------------------

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "query_trades",
    description:
      "Fetch the trader's own individual trades matching a filter. Use when the question is about specific trades, or to inspect the rows behind a number. Returns compact rows plus the total number matched.",
    parameters: {
      type: "object",
      properties: {
        filter: {
          type: "object",
          description: "All fields optional and AND-combined.",
          properties: {
            ticker: { type: "string" },
            direction: { type: "string", enum: ["long", "short"] },
            status: { type: "string", enum: ["pending", "open", "closed", "expired"] },
            result: { type: "string", enum: ["open", "win", "loss", "break_even"] },
            mode: { type: "string", enum: ["trade", "investment"] },
            strategy: { type: "string", description: "Strategy name the trade is tagged with." },
            date_from: { type: "string", description: "ISO date (inclusive); matched on exit date, else entry date." },
            date_to: { type: "string", description: "ISO date (inclusive)." },
            pl_min: { type: "number" },
            pl_max: { type: "number" },
            r_min: { type: "number" },
            r_max: { type: "number" },
            risk_max: { type: "number", description: "Max risk as percent of account, e.g. 1 means 1%." },
            custom_field: {
              type: "object",
              properties: { key: { type: "string" }, value: { type: "string" } },
              required: ["key", "value"],
            },
          },
        },
        sort_by: { type: "string", enum: ["entry_date", "exit_date", "dollar_pl", "r_multiple", "risk_percent"] },
        sort_dir: { type: "string", enum: ["asc", "desc"] },
        limit: { type: "number", description: `1-${MAX_ROWS_OUT}, default 20.` },
      },
    },
  },
  {
    name: "compute_stats",
    description:
      "Compute EXACT performance statistics over the trader's trades, optionally grouped. Prefer this over doing arithmetic yourself. Defaults to closed non-investment trades (the ones with realised P&L). Metrics per group: trades, wins, losses, winRate, totalPL, avgPL, medianPL, avgR, profitFactor, expectancyR.",
    parameters: {
      type: "object",
      properties: {
        filter: { type: "object", description: "Same shape as query_trades.filter; all optional." },
        group_by: {
          type: "string",
          enum: [
            "none",
            "day_of_week",
            "month",
            "hour_of_day",
            "ticker",
            "direction",
            "result",
            "strategy",
            "emotion_before",
            "risk_bucket",
            "hold_bucket",
          ],
        },
        closed_only: {
          type: "boolean",
          description: "Default true. Set false to include open/pending/investment positions.",
        },
      },
    },
  },
  {
    name: "get_trade",
    description:
      "Full detail of ONE trade, including every custom field and note. Look it up by id, or by ticker (optionally plus an ISO date to disambiguate).",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        ticker: { type: "string" },
        date: { type: "string", description: "ISO date to disambiguate multiple trades of the same ticker." },
      },
    },
  },
  {
    name: "get_account",
    description:
      "The trader's cash ledger: deposits, withdrawals, net contributed, realised P&L and an estimated current balance.",
    parameters: { type: "object", properties: {} },
  },
];

/**
 * Builds the executor the orchestrator calls for each tool the model requests.
 * Bound to one RLS-scoped client, so it can only read the caller's own data.
 * Always resolves to a JSON string (never throws): a tool error is data the
 * model can read and recover from, not a request failure.
 */
export function makeToolExecutor(supabase: SupabaseClient, timezone: string | null) {
  return async function execute(call: ToolCall): Promise<string> {
    try {
      let result: unknown;
      switch (call.name) {
        case "query_trades":
          result = await queryTrades(supabase, queryTradesSchema.parse(call.args));
          break;
        case "compute_stats":
          result = await computeStats(supabase, computeStatsSchema.parse(call.args), timezone);
          break;
        case "get_trade":
          result = await getTrade(supabase, getTradeSchema.parse(call.args));
          break;
        case "get_account":
          result = await getAccount(supabase);
          break;
        default:
          return JSON.stringify({ error: `Unknown tool "${call.name}".` });
      }
      return JSON.stringify(result);
    } catch (err) {
      const msg = err instanceof z.ZodError ? err.issues.map((i) => i.message).join("; ") : "tool failed";
      return JSON.stringify({ error: msg });
    }
  };
}
