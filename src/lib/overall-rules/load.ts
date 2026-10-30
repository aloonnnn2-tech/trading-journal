import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { detectAdjustments, type TradeAdjustments } from "@/lib/trades/adjustments";
import type { Trade } from "@/lib/trades/types";
import { log } from "@/lib/observability/log";
import { evaluateOverallRules } from "./evaluate";
import { periodAdherence, type PeriodAdherence } from "./month";
import { listOverallRules, listStoredChecks, refreshMarketChecks } from "./queries";
import type { RuleCheck } from "./types";

// Loading a trade's (or a period's) overall-rule results: rules, stored
// moving-average results refreshed where stale, field rules live.

const REFRESH_WAIT_MS = 4_000;

export interface TradeRulesResult {
  /** False until 0081 is applied. */
  ready: boolean;
  checks: RuleCheck[];
  hasRules: boolean;
}

/**
 * One trade. A stale moving-average result is worked out now (one price
 * fetch), unless `refresh` is false -- the side panel shows what's stored.
 */
export async function loadTradeRuleChecks(
  supabase: SupabaseClient,
  userId: string,
  trade: Trade,
  adjustments: TradeAdjustments | null,
  options: { refresh?: boolean; waitMs?: number } = {},
): Promise<TradeRulesResult> {
  const rules = await listOverallRules(supabase).catch((error) => {
    log.error("overall_rules.load_failed", { error });
    return [];
  });
  if (rules === null) return { ready: false, checks: [], hasRules: false };
  if (rules.length === 0) return { ready: true, checks: [], hasRules: false };

  let stored = await listStoredChecks(supabase, [trade.id]);
  if (options.refresh !== false) {
    try {
      // The page waits at most REFRESH_WAIT_MS for prices: a slow provider
      // shows what's stored ("not checked yet") rather than holding the
      // whole trade page. The refresh still finishes and stores its result.
      const refreshing = refreshMarketChecks(supabase, userId, [trade], rules, { maxSymbols: 1 });
      refreshing.catch((error) => log.warn("overall_rules.refresh_failed", { tradeId: trade.id, error }));
      const refreshed = await Promise.race([
        refreshing,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), options.waitMs ?? REFRESH_WAIT_MS)),
      ]);
      if (refreshed && refreshed.stored.length > 0) {
        const fresh = new Set(refreshed.stored.map((s) => s.rule_id));
        stored = [...stored.filter((s) => !fresh.has(s.rule_id)), ...refreshed.stored];
      }
    } catch (error) {
      // Prices are an enrichment here: the field rules still show.
      log.warn("overall_rules.refresh_failed", { tradeId: trade.id, error });
    }
  }
  return { ready: true, checks: evaluateOverallRules({ trade, rules, adjustments, stored }), hasRules: true };
}

export interface PeriodRulesResult {
  ready: boolean;
  adherence: PeriodAdherence | null;
  /** Price checks left for later (the app-wide price ceiling, an outage). */
  deferred: number;
}

/**
 * Every closed trade that exited in [start, end), checked and rolled up.
 * Stale moving-average results are refreshed first (capped, so a review
 * stays inside its time budget).
 */
export async function loadPeriodRuleAdherence(
  supabase: SupabaseClient,
  userId: string,
  period: { start: string; end: string },
  options: { refresh?: boolean; maxSymbols?: number; waitMs?: number } = {},
): Promise<PeriodRulesResult> {
  const rules = await listOverallRules(supabase);
  if (rules === null) return { ready: false, adherence: null, deferred: 0 };
  if (rules.filter((r) => r.enabled).length === 0) return { ready: true, adherence: null, deferred: 0 };

  const trades = await fetchAllRows<Trade>((from, to) =>
    supabase
      .from("trades")
      .select("*")
      .eq("status", "closed")
      .neq("mode", "investment")
      .gte("exit_date", period.start)
      .lt("exit_date", period.end)
      .order("exit_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (trades.length === 0) return { ready: true, adherence: periodAdherence(rules, []), deferred: 0 };

  const ids = trades.map((t) => t.id);
  let deferred = 0;
  if (options.refresh !== false) {
    try {
      const refreshing = refreshMarketChecks(supabase, userId, trades, rules, {
        maxSymbols: options.maxSymbols ?? 25,
      });
      refreshing.catch((error) => log.warn("overall_rules.period_refresh_failed", { error }));
      // A page waits at most waitMs; what's not done yet shows as "not
      // checked yet" and is stored for next time.
      const refreshed = options.waitMs
        ? await Promise.race([refreshing, new Promise<null>((resolve) => setTimeout(() => resolve(null), options.waitMs))])
        : await refreshing;
      deferred = refreshed ? refreshed.summary.deferred : 0;
    } catch (error) {
      log.warn("overall_rules.period_refresh_failed", { error });
    }
  }
  const [stored, adjustments] = await Promise.all([listStoredChecks(supabase, ids), loadAdjustments(supabase, trades)]);

  const rows = trades.map((trade) => ({
    trade,
    checks: evaluateOverallRules({ trade, rules, adjustments: adjustments.get(trade.id) ?? null, stored }),
  }));
  return { ready: true, adherence: periodAdherence(rules, rows), deferred };
}

type HistoryRow = { trade_id: string; stop: number | null; target: number | null };

/** Stop/target moves for many trades from their edit history, in bulk. */
async function loadAdjustments(supabase: SupabaseClient, trades: Trade[]): Promise<Map<string, TradeAdjustments>> {
  const byTrade = new Map<string, HistoryRow[]>();
  for (let i = 0; i < trades.length; i += 200) {
    const ids = trades.slice(i, i + 200).map((t) => t.id);
    const { data, error } = (await supabase
      .from("trade_history")
      .select("trade_id, stop:snapshot->stop_loss, target:snapshot->take_profit")
      .in("trade_id", ids)
      .order("created_at", { ascending: true })) as unknown as { data: HistoryRow[] | null; error: unknown };
    // History is an enrichment: without it stop/target rules are unevaluable.
    if (error) return new Map();
    for (const row of data ?? []) {
      const list = byTrade.get(row.trade_id) ?? [];
      list.push(row);
      byTrade.set(row.trade_id, list);
    }
  }
  const out = new Map<string, TradeAdjustments>();
  for (const trade of trades) {
    const history = byTrade.get(trade.id) ?? [];
    out.set(
      trade.id,
      detectAdjustments(
        history.map((h) => ({ stop_loss: h.stop, take_profit: h.target })),
        trade,
      ),
    );
  }
  return out;
}
