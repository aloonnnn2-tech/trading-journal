import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolCall, ToolDef } from "../providers/types";
import type { TierPolicy } from "../tier";
import { GROUP_BY, MAX_ROWS_OUT } from "./filter";
import { fitToBudget } from "./envelope";
import { TradeStore } from "./store";
import {
  computeStats,
  computeStatsSchema,
  getAccount,
  getAccountSchema,
  getTrade,
  getTradeHistory,
  getTradeHistorySchema,
  getTradeSchema,
  queryTrades,
  queryTradesSchema,
  type ToolContext,
} from "./journal";
import {
  getSettings,
  listCommissionRulesTool,
  listCustomFields,
  listFolders,
  listFoldersSchema,
  listStrategies,
} from "./setup";
import {
  PERIOD_CHOICES,
  REPORT_KINDS,
  getPeriodReport,
  getPeriodReportSchema,
  getReport,
  getReportSchema,
  getReviews,
  getReviewsSchema,
} from "./reports";

// The read-only tools the chat can call to reach the trader's own data and
// get EXACT numbers computed here rather than guessed from a text dump.
//
// Every executor runs on the RLS-scoped client the route hands in, so a tool
// can only ever read the asking user's own rows. Nothing here writes. There
// is deliberately no free-form query tool: the model chooses from a fixed,
// validated surface, so a prompt-injected instruction inside a trade note can
// at worst waste a call, never reach another user or mutate anything.

export { TradeStore } from "./store";
export type { ToolContext } from "./journal";

// ---- definitions ----------------------------------------------------------
//
// Two descriptions per tool where it matters: the full one for paid keys,
// and a shorter one for free tiers, where every tool definition is re-sent
// on every turn and eats into an 8 000 tokens/minute budget. Same schema
// either way -- only the prose shrinks.

interface Def {
  name: string;
  full: string;
  compact?: string;
  parameters: Record<string, unknown>;
  /** In the free-tier set? Defaults to false. */
  compactSet?: boolean;
}

const FILTER_PARAM = {
  type: "object",
  description: "All fields optional and AND-combined.",
  properties: {
    ticker: { type: "string" },
    direction: { type: "string", enum: ["long", "short"] },
    status: { type: "string", enum: ["pending", "open", "closed", "expired"] },
    result: { type: "string", enum: ["open", "win", "loss", "break_even"] },
    mode: { type: "string", enum: ["trade", "investment"] },
    strategy: { type: "string", description: "Strategy name the trade is tagged with." },
    folder: { type: "string", description: "Folder name the trade is in." },
    market: { type: "string" },
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
};

const DEFS: Def[] = [
  {
    name: "query_trades",
    compactSet: true,
    full: "Fetch the trader's own trades matching a filter. Use for questions about specific trades, or to inspect the rows behind a number. Returns compact rows, the total matched, and `truncated` when there are more -- page with `offset`. Set include=\"notes\" to get each trade's notes and custom fields inline instead of calling get_trade per row.",
    compact: "Fetch trades matching a filter. Returns rows + total; page with offset. include=\"notes\" adds notes/fields.",
    parameters: {
      type: "object",
      properties: {
        filter: FILTER_PARAM,
        sort_by: { type: "string", enum: ["entry_date", "exit_date", "dollar_pl", "r_multiple", "risk_percent"] },
        sort_dir: { type: "string", enum: ["asc", "desc"] },
        limit: { type: "number", description: `1-${MAX_ROWS_OUT}, default 20.` },
        offset: { type: "number", description: "Skip this many matches; for paging." },
        include: { type: "string", enum: ["summary", "notes"] },
      },
    },
  },
  {
    name: "compute_stats",
    compactSet: true,
    full: "Compute EXACT performance statistics over the trader's trades, optionally grouped. Prefer this over doing arithmetic yourself. Defaults to closed non-investment trades (the ones with realised P&L). Per group: trades, wins, losses, winRate, totalPL, avgPL, medianPL, avgWin, avgLoss, largestWin, largestLoss, avgR, profitFactor.",
    compact: "EXACT stats over trades, optionally grouped. Prefer over your own arithmetic. Defaults to closed trades.",
    parameters: {
      type: "object",
      properties: {
        filter: { ...FILTER_PARAM, description: "Same shape as query_trades.filter; all optional." },
        group_by: { type: "string", enum: [...GROUP_BY] },
        closed_only: { type: "boolean", description: "Default true. Set false to include open/pending/investment positions." },
      },
    },
  },
  {
    name: "get_trade",
    compactSet: true,
    full: "Full detail of ONE trade: every field, notes and custom fields under their labels, strategy tags, attached chart count, edit summary (was the stop or target moved?), and how it scored against the strategy's rules. Look it up by id, or by ticker (optionally plus an ISO date).",
    compact: "Full detail of ONE trade incl. notes, fields, edits and rule adherence. By id, or ticker (+ date).",
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
    name: "get_trade_history",
    full: "The edit timeline of one trade: every recorded change to stop, target, prices or dates, in order. Use when asked whether a plan was changed mid-trade, or what happened when.",
    parameters: { type: "object", properties: { trade_id: { type: "string" } }, required: ["trade_id"] },
  },
  {
    name: "get_account",
    compactSet: true,
    full: "The cash account: net deposits, realised P&L, current balance, cash committed to open positions, available cash, and recent transactions.",
    compact: "Cash account: deposits, realised P&L, balance, committed and available cash, recent transactions.",
    parameters: {
      type: "object",
      properties: { transactions_limit: { type: "number", description: "0-100, default 20." } },
    },
  },
  {
    name: "list_strategies",
    compactSet: true,
    full: "Every strategy with its description, trade count, win rate, total P&L, and the trading-plan rules defined for it.",
    compact: "All strategies with stats and their plan rules.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "list_custom_fields",
    full: "The custom fields defined on this journal (label, key, type, choices) for trades, investments, and per strategy. Use to learn what notes/emotion/mistake fields exist before filtering on one.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "list_folders",
    full: "The trader's folders with trade counts; pass a folder name to get the trade ids in it.",
    parameters: { type: "object", properties: { folder: { type: "string" } } },
  },
  {
    name: "list_commission_rules",
    full: "The commission rules the journal applies to trades.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_settings",
    full: "The trader's timezone and today's local date and weekday. Call this before resolving relative dates like 'this week' or 'last month'.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_period_report",
    compactSet: true,
    full: "A full performance report for a period: summary stats, best/worst strategy, biggest mistake, best/worst trade, risk sizing. Periods are as a person means them: this_month is the current month to date; last_month is the previous complete month; this_week is Monday to today; last_week is the previous Monday–Sunday; last_7_days is a rolling week. Set compare_previous to also get the period before and the delta.",
    compact: "Performance report for a period: this_month (to date), last_month, this_week, last_week, last_7_days, custom. compare_previous adds the prior period + delta.",
    parameters: {
      type: "object",
      properties: {
        period: { type: "string", enum: [...PERIOD_CHOICES] },
        start: { type: "string", description: "YYYY-MM-DD, custom only." },
        end: { type: "string", description: "YYYY-MM-DD, custom only." },
        compare_previous: { type: "boolean" },
      },
      required: ["period"],
    },
  },
  {
    name: "get_report",
    compactSet: true,
    full: `One of the journal's computed analytics reports. kind: equity_curve (cumulative P&L and account equity over time), drawdown (episodes: depth, duration, recovery; is the current one the deepest?), edge (which setups/conditions carry the edge and which leak), scorecards (per-strategy trend and best/worst condition), insights (win-rate deviations by day/direction/strategy/emotion/risk), risk (position sizing after wins vs losses, outliers), regime (performance in high vs low market volatility), mistakes (tagged and detected mistakes with the cost of each), goals (the trader's goals and progress), excursions (MAE/MFE -- how far trades went for and against before exit).`,
    compact: `A computed report. kind: ${REPORT_KINDS.join(", ")}.`,
    parameters: { type: "object", properties: { kind: { type: "string", enum: [...REPORT_KINDS] } }, required: ["kind"] },
  },
  {
    name: "get_reviews",
    full: "Past AI reviews the trader generated: the review for one trade (by trade_id), or recent weekly/monthly reviews. Useful for 'what did the last review say' or to avoid repeating advice already given.",
    parameters: {
      type: "object",
      properties: { trade_id: { type: "string" }, limit: { type: "number", description: "1-20, default 5." } },
    },
  },
];

function toToolDef(d: Def, compact: boolean): ToolDef {
  return { name: d.name, description: compact && d.compact ? d.compact : d.full, parameters: d.parameters };
}

/** The definitions offered to the model under a given tier policy. */
export function toolDefsFor(policy: TierPolicy): ToolDef[] {
  if (policy.toolSet === "compact") {
    return DEFS.filter((d) => d.compactSet).map((d) => toToolDef(d, true));
  }
  return DEFS.map((d) => toToolDef(d, false));
}

/** Every tool, full descriptions -- what a paid key sees. */
export const TOOL_DEFS: ToolDef[] = DEFS.map((d) => toToolDef(d, false));

// ---- executor ---------------------------------------------------------------

/** Output ceiling when the caller names none: the paid tier's. */
const DEFAULT_OUTPUT_BUDGET = 24_000;

/**
 * Builds the executor the turn calls for each tool the model requests.
 * Bound to one RLS-scoped client and one per-request TradeStore, so it can
 * only read the caller's own data and never fetches the journal twice in a
 * turn. Always resolves to a JSON string (never throws): a tool error is
 * data the model can read and recover from, not a request failure.
 *
 * `maxOutputChars` is the tier's ceiling on one result (TierPolicy). The
 * tools size themselves to it -- a page that would overflow is cut to fit,
 * long review texts are clipped shorter -- so the model gets a usable,
 * honestly-truncated result rather than an error on a free tier.
 */
export function makeToolExecutor(
  supabase: SupabaseClient,
  timezone: string | null,
  store?: TradeStore,
  maxOutputChars: number = DEFAULT_OUTPUT_BUDGET,
) {
  const ctx: ToolContext = {
    supabase,
    timezone,
    store: store ?? new TradeStore(supabase, timezone),
    outputBudget: maxOutputChars,
  };

  return async function execute(call: ToolCall): Promise<string> {
    try {
      let result: unknown;
      switch (call.name) {
        case "query_trades":
          result = await queryTrades(ctx, queryTradesSchema.parse(call.args));
          break;
        case "compute_stats":
          result = await computeStats(ctx, computeStatsSchema.parse(call.args));
          break;
        case "get_trade":
          result = await getTrade(ctx, getTradeSchema.parse(call.args));
          break;
        case "get_trade_history":
          result = await getTradeHistory(ctx, getTradeHistorySchema.parse(call.args));
          break;
        case "get_account":
          result = await getAccount(ctx, getAccountSchema.parse(call.args ?? {}));
          break;
        case "list_strategies":
          result = await listStrategies(ctx);
          break;
        case "list_custom_fields":
          result = await listCustomFields(ctx);
          break;
        case "list_folders":
          result = await listFolders(ctx, listFoldersSchema.parse(call.args ?? {}));
          break;
        case "list_commission_rules":
          result = await listCommissionRulesTool(ctx);
          break;
        case "get_settings":
          result = getSettings(ctx);
          break;
        case "get_period_report":
          result = await getPeriodReport(ctx, getPeriodReportSchema.parse(call.args));
          break;
        case "get_report":
          result = await getReport(ctx, getReportSchema.parse(call.args));
          break;
        case "get_reviews":
          result = await getReviews(ctx, getReviewsSchema.parse(call.args ?? {}));
          break;
        default:
          return JSON.stringify({ error: `Unknown tool "${call.name}".` });
      }
      return fitToBudget(result, maxOutputChars);
    } catch (err) {
      const msg = err instanceof z.ZodError ? err.issues.map((i) => i.message).join("; ") : "tool failed";
      return JSON.stringify({ error: msg });
    }
  };
}
