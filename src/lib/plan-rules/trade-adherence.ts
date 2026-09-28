import { evaluateStrategyRules } from "@/lib/plan-rules/evaluate";
import type { StrategyAdherence, StrategyRule } from "@/lib/plan-rules/types";
import { detectAdjustments, type TradeAdjustments } from "@/lib/trades/adjustments";
import type { TradeHistoryEntry } from "@/lib/trades/history";
import type { Trade } from "@/lib/trades/types";

// One trade's plan adherence, from data already loaded. Shared by the trade
// page and the trade side panel (Phase 4A of docs/design-audit.md), so the two
// can never score the same trade differently. Pure: the callers do the reads.
//
// Computed rather than stored -- it is a function of the trade, its
// strategies' rules and its edit history, so recomputing is both cheap and
// the only way it can never be stale. See 0033.

export interface TradeAdherenceInput {
  trade: Trade;
  /** The strategies this trade is tagged with. */
  strategyIds: string[];
  /** For the strategies' names. */
  strategies: { id: string; name: string }[];
  rulesByStrategy: Record<string, StrategyRule[]>;
  /** Newest-first, as listTradeHistory returns it. */
  history: TradeHistoryEntry[];
}

export interface TradeAdherenceResult {
  /** Also what the tag suggestions need, so the trade page reuses it. */
  adjustments: TradeAdjustments;
  /** One per tagged strategy that has at least one enabled rule. */
  adherences: StrategyAdherence[];
}

export function planAdherenceFor(input: TradeAdherenceInput): TradeAdherenceResult {
  const { trade, strategyIds, strategies, rulesByStrategy, history } = input;

  const adjustments = detectAdjustments(
    // The detector wants oldest-first.
    [...history].reverse().map((entry) => ({
      stop_loss: entry.snapshot?.stop_loss ?? null,
      take_profit: entry.snapshot?.take_profit ?? null,
    })),
    trade,
  );

  const adherences = strategyIds
    .filter((strategyId) => (rulesByStrategy[strategyId] ?? []).some((rule) => rule.enabled))
    .map((strategyId) =>
      evaluateStrategyRules(
        { trade, strategyId, rules: rulesByStrategy[strategyId] ?? [], adjustments },
        strategies.find((s) => s.id === strategyId)?.name ?? "Strategy",
      ),
    );

  return { adjustments, adherences };
}
