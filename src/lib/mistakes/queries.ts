import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { detectAdjustments } from "@/lib/trades/adjustments";
import { evaluateStrategyRules } from "@/lib/plan-rules/evaluate";
import { listRulesForStrategies } from "@/lib/plan-rules/queries";
import type { StrategyRule } from "@/lib/plan-rules/types";
import type { Trade } from "@/lib/trades/types";
import {
  analyseMistakes,
  detectMistakes,
  medianRiskPercent,
  type MistakeSummary,
  type MistakeTrade,
} from "./analyze";

// Assembles every mistake on every closed trade, from all three sources, then
// hands the result to the pure analyser.
//
// The trade filters here are the ones every other stats module uses -- closed,
// with an exit date, excluding investment mode -- so the cohort counted here
// is the same cohort the Analytics page counts. Investment trades in
// particular carry a null dollar_pl, which would otherwise be read as a loss
// for whatever mistake they were tagged with.

/** The tag field seeded by migration 0034. */
const MISTAKE_FIELD_KEY = "trade_mistakes";

interface TradeRow {
  id: string;
  ticker: string | null;
  direction: string | null;
  exit_price: number | null;
  take_profit: number | null;
  stop_loss: number | null;
  risk_percent: number | null;
  r_multiple: number | null;
  dollar_pl: number | null;
  entry_date: string | null;
  exit_date: string | null;
  custom_fields: Record<string, unknown> | null;
  strategy_field_values: Record<string, Record<string, unknown>> | null;
  trade_strategies?: { strategy_id: string }[];
}

interface HistoryRow {
  trade_id: string;
  stop: number | null;
  target: number | null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export interface MistakeReport {
  summaries: MistakeSummary[];
  /** Closed trades considered, so the UI can say what the figures cover. */
  tradesAnalysed: number;
  /** True when no trade carries a hand-tagged mistake, so the UI can point at
   *  the Mistakes field rather than implying none were ever made. */
  nothingTagged: boolean;
}

/**
 * Every closed trade with its mistake labels attached, from all three sources.
 *
 * Exported so the goals feature can count "how many trades moved a stop this
 * month" without a second implementation of the detectors -- a reduction goal
 * and the mistake tracker must never disagree about what a moved stop is.
 */
export async function buildMistakeTrades(supabase: SupabaseClient): Promise<MistakeTrade[]> {
  const rows = await fetchAllRows<TradeRow>((from, to) =>
    supabase
      .from("trades")
      .select(
        "id, ticker, direction, exit_price, take_profit, stop_loss, risk_percent, r_multiple, dollar_pl, entry_date, exit_date, custom_fields, strategy_field_values, trade_strategies(strategy_id)",
      )
      .eq("status", "closed")
      .not("exit_date", "is", null)
      .neq("mode", "investment")
      .order("exit_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );

  if (rows.length === 0) return [];

  // ---- Edit history, in ONE query -----------------------------------------
  //
  // The naive version calls listTradeHistory per trade, which is one round
  // trip per row -- fine on a trade page, ruinous on a page that reads the
  // whole journal. The two jsonb keys are projected server-side rather than
  // shipping every full-row snapshot, which is the same fix getEmotionBreakdown
  // uses for custom_fields.
  const historyRows = await fetchAllRows<HistoryRow>(
    (from, to) =>
      // Cast because a jsonb projection is typed as `Json`; at runtime these
      // are the numbers (or nulls) the snapshot held.
      supabase
        .from("trade_history")
        .select("trade_id, stop:snapshot->stop_loss, target:snapshot->take_profit")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: HistoryRow[] | null;
        error: { message?: string; code?: string } | null;
      }>,
    // History is an enrichment, not the feature: a journal predating the
    // snapshot trigger simply has none, and that must not take the page down.
  ).catch(() => [] as HistoryRow[]);

  //
  // Cost note: this is O(snapshots across the whole journal), paged 1,000 at a
  // time. Three tiny columns per row keeps that cheap in practice -- most
  // trades carry a handful of snapshots, not the 50 the retention cap allows.
  // If it ever becomes the slow part of this page, the upgrade path is an RPC
  // returning one row per trade (the same reason dashboard_stats exists),
  // not a per-trade query loop.
  const historyByTrade = new Map<string, HistoryRow[]>();
  for (const row of historyRows) {
    (historyByTrade.get(row.trade_id) ?? historyByTrade.set(row.trade_id, []).get(row.trade_id)!).push(row);
  }

  // ---- Plan rules ----------------------------------------------------------
  const strategyIds = Array.from(
    new Set(rows.flatMap((row) => (row.trade_strategies ?? []).map((s) => s.strategy_id))),
  );
  const rulesByStrategy: Record<string, StrategyRule[]> = await listRulesForStrategies(
    supabase,
    strategyIds,
  ).catch(() => ({}));

  // ---- Per-trade assembly --------------------------------------------------
  const base: MistakeTrade[] = rows.map((row) => ({
    id: row.id,
    ticker: row.ticker,
    exit_date: row.exit_date,
    dollar_pl: row.dollar_pl,
    r_multiple: row.r_multiple,
    risk_percent: row.risk_percent,
    stop_loss: row.stop_loss,
    take_profit: row.take_profit,
    exit_price: row.exit_price,
    direction: row.direction,
    mistakes: [],
  }));

  // Computed once over the whole journal: "oversized" means oversized for this
  // trader, so the baseline must be the same for every trade being judged.
  const medianRisk = medianRiskPercent(base);

  base.forEach((trade, index) => {
    const row = rows[index];
    const snapshots = historyByTrade.get(trade.id) ?? [];
    const adjustments = detectAdjustments(
      snapshots.map((s) => ({ stop_loss: s.stop, take_profit: s.target })),
      { stop_loss: row.stop_loss, take_profit: row.take_profit },
    );

    // 1. Detected automatically.
    for (const label of detectMistakes({
      trade,
      // A trade with no snapshots was never edited, so "not moved" is a real
      // answer rather than a missing one -- see adjustments.ts.
      stopMoved: adjustments.stopMoved,
      targetMoved: adjustments.targetMoved,
      medianRisk,
    })) {
      trade.mistakes.push({ label, source: "detected" });
    }

    // 2. Broken plan rules (Feature 1). A failed rule IS a violation, already
    //    named by the trader. Unevaluable rules are skipped -- a rule that
    //    couldn't be checked was not broken.
    for (const link of row.trade_strategies ?? []) {
      const rules = rulesByStrategy[link.strategy_id];
      if (!rules || rules.length === 0) continue;

      const adherence = evaluateStrategyRules(
        {
          trade: {
            ...row,
            custom_fields: row.custom_fields ?? {},
            strategy_field_values: row.strategy_field_values ?? {},
          } as unknown as Trade,
          strategyId: link.strategy_id,
          rules,
          adjustments,
        },
        "",
      );
      for (const evaluation of adherence.evaluations) {
        if (evaluation.outcome === "fail") {
          trade.mistakes.push({ label: evaluation.rule.label, source: "rule" });
        }
      }
    }

    // 3. Tagged by hand.
    for (const label of asStringArray(row.custom_fields?.[MISTAKE_FIELD_KEY])) {
      trade.mistakes.push({ label, source: "tagged" });
    }
  });

  return base;
}

export async function getMistakeReport(supabase: SupabaseClient): Promise<MistakeReport> {
  const base = await buildMistakeTrades(supabase);

  return {
    summaries: analyseMistakes(base),
    tradesAnalysed: base.length,
    // Only meaningful as "nobody has tagged anything": the UI uses it to point
    // at the Mistakes field rather than to imply no mistakes were made.
    nothingTagged: base.every((t) => !t.mistakes.some((m) => m.source === "tagged")),
  };
}
