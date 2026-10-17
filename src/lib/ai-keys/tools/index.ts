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
import { calculate, calculateSchema, getMarketData, getMarketDataSchema } from "./general";
import { explainMetric, explainMetricSchema } from "./metrics";
import { viewTradeChart, viewTradeChartSchema } from "./charts";
import { FILLABLE_FIELDS, proposeChange, proposeChangeSchema } from "./proposals";
import type { VisionState } from "../vision";

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
  /** Only offered when the provider can see images. */
  needsVision?: boolean;
  /** Only offered when the conversation can carry suggested changes (0070). */
  needsProposals?: boolean;
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
    name: "explain_metric",
    compactSet: true,
    full: "Explain any figure in the journal and give this trader's value in one call: what it means and exactly how Trading Lens computes it, how to judge it (direction, common rules of thumb), its caveats, where it is in the app, and their current value. Use for 'what is my X / is my X good'. Accepts names and aliases (MAE, MFE, capture, profit factor, expectancy, win rate, drawdown, risk per trade, streaks, edge, mistakes, R multiple, ...). Per-trade metrics take `trade` ({id} or {ticker, date}). An unknown name returns the list of known ones.",
    compact: "Meaning, how to judge, and their value for any figure (MAE, PF, win rate...).",
    parameters: {
      type: "object",
      properties: {
        metric: { type: "string" },
        trade: { type: "object", description: "{id} or {ticker, date}, for per-trade figures." },
      },
      required: ["metric"],
    },
  },
  {
    name: "get_market_data",
    compactSet: true,
    full: "Live-ish market data for any ticker (not only ones in the journal): current quote with its time, and daily price history over a range with high, low and % change. Yahoo symbols: stocks AAPL, crypto BTC-USD, forex EURUSD=X, indices ^GSPC / ^IXIC. Quotes may be delayed -- say when the quote is from. news: true adds recent headlines (titles and links only, no article text).",
    compact: "Quote + daily prices, any ticker (BTC-USD, EURUSD=X, ^GSPC). news:true adds headlines.",
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        range: { type: "string", enum: ["5d", "1mo", "3mo", "6mo", "1y", "2y", "5y"] },
        news: { type: "boolean" },
      },
      required: ["symbol"],
    },
  },
  {
    name: "calculate",
    compactSet: true,
    full: "Exact arithmetic: + - * / ^ %, parentheses, sqrt, abs, round(x, digits), floor, ceil, min, max, log, ln, exp, pow, pi. Use it for any calculation (position size, R multiple, what-if P/L, compounding) instead of doing the maths yourself.",
    compact: "Exact maths: +-*/^%, sqrt, round(x,d), min, max, pow.",
    parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] },
  },
  {
    name: "view_trade_chart",
    compactSet: true,
    needsVision: true,
    full: "Look at one of a trade's chart screenshots: pass an image id from get_trade's `images`. The image is attached to the result. Use it to judge entries, exits, stops and the setup against the chart. At most 3 per question.",
    compact: "See a trade's chart screenshot (image_id from get_trade).",
    parameters: { type: "object", properties: { image_id: { type: "string" } }, required: ["image_id"] },
  },
  {
    name: "propose_change",
    compactSet: true,
    needsProposals: true,
    full:
      "Suggest a change to the journal. It is NOT made: the user sees a card with Apply / Dismiss and decides. " +
      "Name the trade by trade_id, or ticker + date. " +
      `fill_field: field (${FILLABLE_FIELDS.join(", ")}) + value -- only a field that is empty now. ` +
      "tag_strategy: strategy (an existing strategy's name). " +
      "add_note: text, added after what's there (field: a notes field's name; default the main one). " +
      "tag_mistake: mistake (one of the journal's mistake tags). " +
      "create_goal: label, goal_kind (aggregate | reduction), target, target_direction (at_least | at_most), " +
      "period (month | quarter | year | all_time), and metric for aggregate (trade_count, win_rate as a % like 55, " +
      "expectancy, avg_loss_r, total_r) or mistake for reduction. " +
      "Only when the user asks for a change or clearly would want one; one call per change.",
    compact:
      "Suggest a change; the user must click Apply. Trade by trade_id or ticker+date. fill_field: field+value (empty fields only); " +
      "tag_strategy: strategy; add_note: text; tag_mistake: mistake; create_goal: label, goal_kind, metric|mistake, target, target_direction, period.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["fill_field", "tag_strategy", "add_note", "tag_mistake", "create_goal"] },
        trade_id: { type: "string" },
        ticker: { type: "string" },
        date: { type: "string" },
        field: { type: "string" },
        value: { type: "string" },
        strategy: { type: "string" },
        text: { type: "string" },
        mistake: { type: "string" },
        label: { type: "string" },
        goal_kind: { type: "string" },
        metric: { type: "string" },
        target: { type: "number" },
        target_direction: { type: "string" },
        period: { type: "string" },
      },
      required: ["kind"],
    },
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
export function toolDefsFor(policy: TierPolicy, options: { vision?: boolean; proposals?: boolean } = {}): ToolDef[] {
  const offered = DEFS.filter((d) => (!d.needsVision || options.vision) && (!d.needsProposals || options.proposals));
  if (policy.toolSet === "compact") {
    return offered.filter((d) => d.compactSet).map((d) => toToolDef(d, true));
  }
  return offered.map((d) => toToolDef(d, false));
}

/** Every tool, full descriptions -- what a paid key on an image-capable provider sees, once 0070 is applied. */
export const TOOL_DEFS: ToolDef[] = DEFS.map((d) => toToolDef(d, false));

// ---- executor ---------------------------------------------------------------

/** Market-data lookups one executor (one model round) will make. */
const MAX_MARKET_LOOKUPS = 6;

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
  options: { vision?: VisionState; proposals?: { conversationId: string; userId: string } } = {},
) {
  const ctx: ToolContext = {
    supabase,
    timezone,
    store: store ?? new TradeStore(supabase, timezone),
    outputBudget: maxOutputChars,
    vision: options.vision,
    proposals: options.proposals ? { ...options.proposals, made: 0 } : undefined,
  };

  let marketLookups = 0;
  const chartsShown = { count: 0 };

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
        case "get_market_data":
          // Each lookup is a request to Yahoo from this app's address: a
          // handful per answer is plenty, and a looping model can't run up
          // the app-wide ceiling everyone shares.
          if (++marketLookups > MAX_MARKET_LOOKUPS) {
            result = { error: `At most ${MAX_MARKET_LOOKUPS} market lookups per answer. Answer with what you have.` };
            break;
          }
          result = await getMarketData(getMarketDataSchema.parse(call.args), ctx.outputBudget);
          break;
        case "calculate":
          result = calculate(calculateSchema.parse(call.args));
          break;
        case "explain_metric":
          result = await explainMetric(ctx, explainMetricSchema.parse(call.args));
          break;
        case "view_trade_chart":
          result = await viewTradeChart(ctx, viewTradeChartSchema.parse(call.args), chartsShown);
          break;
        case "propose_change":
          result = await proposeChange(ctx, call.id, proposeChangeSchema.parse(call.args));
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
