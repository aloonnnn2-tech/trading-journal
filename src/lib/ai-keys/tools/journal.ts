import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Trade } from "@/lib/trades/types";
import { listTradeHistory } from "@/lib/trades/history";
import { detectAdjustments } from "@/lib/trades/adjustments";
import { buildReplay } from "@/lib/replay/build";
import { evaluateStrategyRules } from "@/lib/plan-rules/evaluate";
import { getAccountBalance, listAccountTransactions } from "@/lib/account/queries";
import { listTradeImages } from "@/lib/images/queries";
import {
  GROUP_BY,
  MAX_GROUPS_OUT,
  MAX_ROWS_OUT,
  MAX_TXNS_OUT,
  computeBlock,
  dateOnly,
  filterSchema,
  groupKeys,
  matchesFilter,
  round,
  strategyIds,
  type Filter,
  type Row,
} from "./filter";
import { limited, toolError } from "./envelope";
import { compactRow, compactTradeDetail } from "./sanitize";
import type { TradeStore } from "./store";

// The journal tools: trades, stats, one trade in full, its edit history, and
// the cash account. All read through the per-request TradeStore.

export interface ToolContext {
  supabase: SupabaseClient;
  store: TradeStore;
  timezone: string | null;
  /** The tier's ceiling on one serialised result; tools size long text to it. */
  outputBudget: number;
}

// ---- schemas ---------------------------------------------------------------

export const queryTradesSchema = z
  .object({
    filter: filterSchema,
    sort_by: z.enum(["entry_date", "exit_date", "dollar_pl", "r_multiple", "risk_percent"]).optional(),
    sort_dir: z.enum(["asc", "desc"]).optional(),
    limit: z.number().int().min(1).max(MAX_ROWS_OUT).optional(),
    offset: z.number().int().min(0).optional(),
    /** "notes" adds each trade's notes and custom fields to the rows. */
    include: z.enum(["summary", "notes"]).optional(),
  })
  .strict();

export const computeStatsSchema = z
  .object({
    filter: filterSchema,
    group_by: z.enum(GROUP_BY).optional(),
    closed_only: z.boolean().optional(),
  })
  .strict();

export const getTradeSchema = z
  .object({
    id: z.string().uuid().optional(),
    ticker: z.string().max(40).optional(),
    date: z.string().max(40).optional(),
  })
  .strict();

export const getTradeHistorySchema = z.object({ trade_id: z.string().uuid() }).strict();

export const getAccountSchema = z
  .object({ transactions_limit: z.number().int().min(0).max(MAX_TXNS_OUT).optional() })
  .strict();

// ---- helpers ---------------------------------------------------------------

async function folderLookup(store: TradeStore, f: Filter) {
  if (!f?.folder) return { links: undefined, nameToId: undefined };
  const { folders, links } = await store.folders();
  const nameToId = new Map(folders.map((x) => [x.name.toLowerCase(), x.id]));
  return { links, nameToId };
}

/**
 * Resolves the trade a get_trade call means, and says how sure that is.
 * `otherMatches` is the number of OTHER trades of the same ticker that the
 * arguments did not rule out: with it the model can tell the user "your
 * most recent AAPL trade -- you have four" instead of presenting one of
 * several as the one they asked about.
 */
async function findTrade(
  store: TradeStore,
  args: z.infer<typeof getTradeSchema>,
): Promise<{ row: Row | undefined; otherMatches: number; dateMatched: boolean }> {
  const all = await store.trades();
  if (args.id) return { row: all.find((t) => t.id === args.id), otherMatches: 0, dateMatched: true };
  if (args.ticker) {
    // Newest first, as the store orders them, so "the AAPL trade" with no
    // date means the most recent one.
    const cands = all.filter((t) => (t.ticker ?? "").toUpperCase() === args.ticker!.toUpperCase());
    if (args.date) {
      const d = args.date.slice(0, 10);
      const onDate = cands.filter((t) => dateOnly(t.exit_date) === d || dateOnly(t.entry_date) === d);
      if (onDate.length > 0) return { row: onDate[0], otherMatches: onDate.length - 1, dateMatched: true };
      return { row: cands[0], otherMatches: Math.max(0, cands.length - 1), dateMatched: false };
    }
    return { row: cands[0], otherMatches: Math.max(0, cands.length - 1), dateMatched: true };
  }
  return { row: undefined, otherMatches: 0, dateMatched: true };
}

// ---- executors ---------------------------------------------------------------

export async function queryTrades(ctx: ToolContext, args: z.infer<typeof queryTradesSchema>) {
  const all = await ctx.store.trades();
  const { links, nameToId } = await folderLookup(ctx.store, args.filter);
  const rows = all.filter((t) => matchesFilter(t, args.filter, links, nameToId));
  const by = args.sort_by ?? "exit_date";
  const dir = args.sort_dir ?? "desc";
  rows.sort((a, b) => {
    const av = a[by];
    const bv = b[by];
    const an = typeof av === "number" ? av : av ? new Date(String(av)).getTime() : -Infinity;
    const bn = typeof bv === "number" ? bv : bv ? new Date(String(bv)).getTime() : -Infinity;
    return dir === "asc" ? an - bn : bn - an;
  });

  const withNotes = args.include === "notes";
  const fields = withNotes ? await ctx.store.fields() : null;
  const strategies = withNotes ? await ctx.store.strategies() : [];
  const page = limited(rows, args.limit ?? 20, args.offset ?? 0);
  return {
    ...page,
    items: page.items.map((t) => (fields ? compactTradeDetail(t, fields, strategies) : compactRow(t))),
  };
}

export async function computeStats(ctx: ToolContext, args: z.infer<typeof computeStatsSchema>) {
  const all = await ctx.store.trades();
  const { links, nameToId } = await folderLookup(ctx.store, args.filter);
  const closedOnly = args.closed_only ?? true;
  const rows = all.filter((t) => {
    if (closedOnly && (t.mode === "investment" || t.status !== "closed")) return false;
    return matchesFilter(t, args.filter, links, nameToId);
  });
  const basis = closedOnly ? "closed non-investment trades" : "all matching positions";
  const by = args.group_by ?? "none";
  const overall = computeBlock(rows);
  if (by === "none") return { basis, overall };

  const groups = new Map<string, Row[]>();
  for (const t of rows) {
    for (const k of groupKeys(t, by, ctx.timezone)) {
      const arr = groups.get(k);
      if (arr) arr.push(t);
      else groups.set(k, [t]);
    }
  }
  const entries = Array.from(groups.entries()).map(([group, rs]) => ({ group, ...computeBlock(rs) }));
  entries.sort((a, b) => b.trades - a.trades);
  const page = limited(entries, MAX_GROUPS_OUT, 0, `only the ${MAX_GROUPS_OUT} largest groups are shown`);
  return { basis, group_by: by, overall, groups: page.items, groups_total: page.total, truncated: page.truncated };
}

export async function getTrade(ctx: ToolContext, args: z.infer<typeof getTradeSchema>) {
  const { row: match, otherMatches, dateMatched } = await findTrade(ctx.store, args);
  if (!match) return { found: false };

  const [fields, strategies, rulesByStrategy, images, history] = await Promise.all([
    ctx.store.fields(),
    ctx.store.strategies(),
    ctx.store.rulesByStrategy(),
    listTradeImages(ctx.supabase, match.id).catch(() => []),
    listTradeHistory(ctx.supabase, match.id).catch(() => []),
  ]);

  // Rule adherence for each strategy this trade is tagged with -- the same
  // assembly the mistake tracker uses, so the two never disagree.
  // listTradeHistory returns newest-first; the detector wants oldest-first.
  const adjustments = detectAdjustments(
    [...history].reverse().map((h) => ({ stop_loss: h.snapshot.stop_loss, take_profit: h.snapshot.take_profit })),
    { stop_loss: match.stop_loss, take_profit: match.take_profit },
  );
  const adherence = strategyIds(match)
    .filter((sid) => (rulesByStrategy[sid] ?? []).length > 0)
    .map((sid) => {
      const name = strategies.find((s) => s.id === sid)?.name ?? sid;
      const a = evaluateStrategyRules(
        {
          trade: {
            ...match,
            custom_fields: match.custom_fields ?? {},
            strategy_field_values: match.strategy_field_values ?? {},
          } as unknown as Trade,
          strategyId: sid,
          rules: rulesByStrategy[sid],
          adjustments,
        },
        name,
      );
      return {
        strategy: name,
        passed: a.passed,
        failed: a.failed,
        unevaluable: a.unevaluable,
        score: a.score,
        rules: a.evaluations.map((e) => ({ rule: e.rule.label, outcome: e.outcome })),
      };
    });

  return {
    found: true,
    ...(otherMatches > 0
      ? {
          otherMatches,
          note: dateMatched
            ? `${otherMatches} other ${match.ticker} trade(s) also match; this is the most recent. Pass a date or id to pick another.`
            : `no ${match.ticker} trade on ${args.date}; this is the most recent one instead, of ${otherMatches + 1}.`,
        }
      : !dateMatched
        ? { note: `no ${match.ticker} trade on ${args.date}; this is the only ${match.ticker} trade.` }
        : {}),
    trade: compactTradeDetail(match, fields, strategies, { images }),
    edits: {
      count: history.length,
      stopMoved: adjustments.stopMoved,
      targetMoved: adjustments.targetMoved,
      historyMayBeTruncated: adjustments.mayBeTruncated,
    },
    ...(adherence.length ? { rule_adherence: adherence } : {}),
  };
}

export async function getTradeHistory(ctx: ToolContext, args: z.infer<typeof getTradeHistorySchema>) {
  const all = await ctx.store.trades();
  const trade = all.find((t) => t.id === args.trade_id);
  if (!trade) return toolError("no trade with that id");
  const history = await listTradeHistory(ctx.supabase, trade.id);
  // Oldest first for the replay builder.
  const snapshots = history.slice().reverse().map((h) => ({ createdAt: h.createdAt, snapshot: h.snapshot }));
  const replay = buildReplay(trade as unknown as Trade, snapshots);
  const events = replay.events.map((e) => ({
    at: e.at,
    kind: e.kind,
    label: e.label,
    ...(e.from !== undefined ? { from: e.from } : {}),
    ...(e.to !== undefined ? { to: e.to } : {}),
  }));
  return {
    trade_id: trade.id,
    ticker: trade.ticker,
    edits: replay.snapshots,
    historyMayBeTruncated: replay.mayBeTruncated,
    timeline: limited(events, 40),
  };
}

export async function getAccount(ctx: ToolContext, args: z.infer<typeof getAccountSchema>) {
  const limit = args.transactions_limit ?? 20;
  const [balance, txns] = await Promise.all([
    getAccountBalance(ctx.supabase),
    limit > 0 ? listAccountTransactions(ctx.supabase, limit) : Promise.resolve([]),
  ]);
  return {
    deposited: round(balance.deposited) ?? 0,
    realisedPL: round(balance.tradePL) ?? 0,
    balance: round(balance.balance) ?? 0,
    committedCash: round(balance.committedCash) ?? 0,
    availableCash: round(balance.availableCash) ?? 0,
    hasTransactions: balance.hasTransactions,
    recentTransactions: txns.map((t) => ({
      date: dateOnly(t.created_at),
      amount: round(Number(t.amount)) ?? 0,
      note: t.note ?? null,
    })),
  };
}
