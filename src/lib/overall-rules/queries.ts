import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTableError } from "@/lib/supabase/errors";
import { fetchYahooBars, guessYahooSymbol } from "@/lib/market-data/yahoo";
import { takeYahooSlot } from "@/lib/rate-limits/daily";
import { log } from "@/lib/observability/log";
import type { Trade } from "@/lib/trades/types";
import { MARKET_KINDS, ruleApplies, staleMarketRules, type StoredCheck } from "./evaluate";
import { checkMaEntry, checkMaExit, lookbackDays, toDailyCloses, tradeDay, type DailyClose } from "./market-checks";
import type { OverallRuleInput } from "./schema";
import type { OverallRule } from "./types";

// Reads and writes for overall_rules and trade_rule_checks (0081), all with
// the caller's RLS client: both tables' policies confine every statement to
// the signed-in user (and trade_rule_checks' to their own trades and rules).

const COLUMNS =
  "id, label, kind, subject_source, subject_key, operator, number_value, number_value_max, text_value, ma_type, ma_period, ma_type_2, ma_period_2, entry_template, grace_days, direction, enabled, sort_order, updated_at";
const CHECK_COLUMNS = "trade_id, rule_id, outcome, detail, trade_updated_at, rule_updated_at, computed_at";

/**
 * The user's overall rules, in order. Null when 0081 isn't applied yet, so
 * a page can say the feature is pending instead of failing.
 */
export async function listOverallRules(supabase: SupabaseClient): Promise<OverallRule[] | null> {
  const { data, error } = await supabase.from("overall_rules").select(COLUMNS).order("sort_order").order("id");
  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  return (data ?? []).map(normalizeRule);
}

// numeric columns arrive as strings from PostgREST in some setups.
function normalizeRule(row: Record<string, unknown>): OverallRule {
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    ...(row as unknown as OverallRule),
    number_value: num(row.number_value),
    number_value_max: num(row.number_value_max),
    ma_period: num(row.ma_period),
    ma_period_2: num(row.ma_period_2),
    grace_days: Number(row.grace_days ?? 1),
  };
}

export async function createOverallRule(
  supabase: SupabaseClient,
  userId: string,
  input: OverallRuleInput,
): Promise<OverallRule> {
  const { data, error } = await supabase
    .from("overall_rules")
    .insert({ user_id: userId, ...input })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return normalizeRule(data);
}

/** Replaces a rule's definition; null when nothing matched (RLS or no such id). */
export async function updateOverallRule(
  supabase: SupabaseClient,
  id: string,
  input: OverallRuleInput,
): Promise<OverallRule | null> {
  const { data, error } = await supabase.from("overall_rules").update(input).eq("id", id).select(COLUMNS);
  if (error) throw error;
  return data?.[0] ? normalizeRule(data[0]) : null;
}

export async function deleteOverallRule(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await supabase.from("overall_rules").delete().eq("id", id).select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/** Stored moving-average results for these trades ([] before 0081). */
export async function listStoredChecks(supabase: SupabaseClient, tradeIds: string[]): Promise<StoredCheck[]> {
  const out: StoredCheck[] = [];
  // Chunked: a long id list in one URL runs past PostgREST's limits.
  for (let i = 0; i < tradeIds.length; i += 200) {
    const { data, error } = await supabase
      .from("trade_rule_checks")
      .select(CHECK_COLUMNS)
      .in("trade_id", tradeIds.slice(i, i + 200));
    if (error) {
      if (isMissingTableError(error)) return [];
      throw error;
    }
    out.push(...((data ?? []) as StoredCheck[]));
  }
  return out;
}

export type RuleCheckTrade = Pick<
  Trade,
  | "id"
  | "mode"
  | "ticker"
  | "asset_type"
  | "direction"
  | "status"
  | "entry_price"
  | "exit_price"
  | "shares"
  | "entry_date"
  | "exit_date"
  | "updated_at"
> & { partial_exits?: unknown };

export interface MarketCheckSummary {
  checked: number;
  /** Symbols skipped because the app-wide price-data ceiling was reached. */
  deferred: number;
  /** Symbols with no price data at all. */
  noData: number;
}

/**
 * Works out every stale moving-average result for these trades and stores
 * it. One price fetch per symbol (all of that symbol's trades share it),
 * each through the app-wide Yahoo ceiling; a symbol over the ceiling is left
 * for next time rather than failing the rest.
 */
export async function refreshMarketChecks(
  supabase: SupabaseClient,
  userId: string,
  trades: RuleCheckTrade[],
  rules: OverallRule[],
  options: { now?: number; maxSymbols?: number } = {},
): Promise<{ stored: StoredCheck[]; summary: MarketCheckSummary }> {
  const now = options.now ?? Date.now();
  const marketRules = rules.filter((r) => MARKET_KINDS.has(r.kind));
  const summary: MarketCheckSummary = { checked: 0, deferred: 0, noData: 0 };
  if (marketRules.length === 0 || trades.length === 0) return { stored: [], summary };

  const existing = await listStoredChecks(
    supabase,
    trades.map((t) => t.id),
  );
  const work = new Map<string, { trade: RuleCheckTrade; rules: OverallRule[] }[]>();
  for (const trade of trades) {
    if (!trade.entry_date) continue;
    const stale = staleMarketRules(trade as Trade, marketRules, existing, now);
    if (stale.length === 0) continue;
    const symbol = guessYahooSymbol(trade.ticker ?? "", trade.asset_type);
    if (!symbol) continue;
    const list = work.get(symbol) ?? [];
    list.push({ trade, rules: stale });
    work.set(symbol, list);
  }

  const rows: StoredCheck[] = [];
  let symbols = 0;
  for (const [symbol, items] of work) {
    if (options.maxSymbols != null && symbols >= options.maxSymbols) {
      summary.deferred += 1;
      continue;
    }
    symbols += 1;
    const window = fetchWindow(items, now);
    if (!(await takeYahooSlot())) {
      summary.deferred += 1;
      continue;
    }
    let closes: DailyClose[] = [];
    let timeZone = "America/New_York";
    try {
      const result = await fetchYahooBars(
        symbol,
        { interval: "1d", period1: window.period1, period2: window.period2, prePost: false },
        Math.floor(now / 1000),
      );
      if (result) {
        timeZone = result.timeZone;
        closes = toDailyCloses(result.bars, result.timeZone);
      }
    } catch (error) {
      // An outage: leave these for next time rather than storing "no data".
      log.warn("overall_rules.fetch_failed", { symbol, error });
      summary.deferred += 1;
      continue;
    }
    if (closes.length === 0) summary.noData += 1;

    for (const { trade, rules: stale } of items) {
      const days = { entryDay: tradeDay(trade.entry_date, timeZone), exitDay: tradeDay(trade.exit_date, timeZone) };
      for (const rule of stale) {
        const check =
          closes.length === 0
            ? { outcome: "unevaluable" as const, detail: { summary: `No daily prices found for ${symbol}.` } }
            : rule.kind === "ma_exit"
              ? checkMaExit(rule, closes, trade, days)
              : checkMaEntry(rule, closes, trade, days);
        rows.push({
          trade_id: trade.id,
          rule_id: rule.id,
          outcome: check.outcome === "ai" ? "unevaluable" : check.outcome,
          detail: check.detail,
          trade_updated_at: trade.updated_at,
          rule_updated_at: rule.updated_at,
          computed_at: new Date(now).toISOString(),
        });
        summary.checked += 1;
      }
    }
  }

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase
      .from("trade_rule_checks")
      .upsert(
        rows.slice(i, i + 200).map((row) => ({ ...row, user_id: userId })),
        { onConflict: "trade_id,rule_id" },
      );
    if (error) {
      if (isMissingTableError(error)) return { stored: [], summary };
      throw error;
    }
  }
  return { stored: rows, summary };
}

/**
 * The span of daily bars a symbol's trades need: from the earliest entry
 * minus the longest average's history, to the latest exit (or now). Whole
 * days, so repeated checks hit Yahoo's cache.
 */
export function fetchWindow(
  items: { trade: RuleCheckTrade; rules: OverallRule[] }[],
  now: number,
): { period1: number; period2: number } {
  const day = 86_400;
  const nowS = Math.floor(now / 1000);
  let first = Infinity;
  let last = 0;
  let lookback = 0;
  for (const { trade, rules } of items) {
    const entry = Date.parse(trade.entry_date ?? "") / 1000;
    if (Number.isFinite(entry)) first = Math.min(first, entry);
    const exit = trade.status === "closed" && trade.exit_date ? Date.parse(trade.exit_date) / 1000 : nowS;
    last = Math.max(last, Number.isFinite(exit) ? exit : nowS);
    for (const rule of rules) lookback = Math.max(lookback, lookbackDays(rule));
  }
  const period1 = Math.floor((first - lookback * day) / day) * day;
  // Two days past the exit covers time zones; never past now (rounded to
  // 10 minutes so a page refresh reuses the cached answer).
  const period2 = Math.min(Math.ceil((last + 2 * day) / day) * day, Math.floor(nowS / 600) * 600);
  return { period1, period2 };
}

/** Rules that need a trade's data checked live (not stored). Exported for the panel loaders. */
export function applicableRules(rules: OverallRule[], trade: Pick<Trade, "mode" | "direction" | "status">): OverallRule[] {
  return rules.filter((r) => ruleApplies(r, trade));
}
