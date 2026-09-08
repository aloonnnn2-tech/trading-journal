import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { MIN_SEGMENT_TRADES } from "@/lib/segments/engine";
import { buildRiskReport, spread, type RiskReport, type RiskTrade, type Spread } from "./analyze";

// Fetching for the risk dashboard.
//
// Chronological order is not cosmetic here: the sequence comparison ("risk on
// the trade after a loss") and the drawdown comparison both walk the journal
// in order, and out-of-order rows would make both meaningless rather than
// merely imprecise.

interface RiskRow extends RiskTrade {
  trade_strategies: { strategies: { name: string }[] }[];
}

export interface StrategyRisk {
  strategy: string;
  risk: Spread;
}

export interface FullRiskReport extends RiskReport {
  byStrategy: StrategyRisk[];
}

export async function getRiskReport(supabase: SupabaseClient): Promise<FullRiskReport> {
  const rows = await fetchAllRows<RiskRow>((from, to) =>
    supabase
      .from("trades")
      .select(
        "id, ticker, exit_date, dollar_pl, r_multiple, risk_percent, position_size, trade_strategies(strategies(name))",
      )
      .eq("status", "closed")
      .not("exit_date", "is", null)
      // Same exclusion as every other stats module: investment positions carry
      // no realised P&L, so they can neither win nor sit in a drawdown.
      .neq("mode", "investment")
      .order("exit_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );

  const byStrategyMap = new Map<string, number[]>();
  for (const row of rows) {
    if (row.risk_percent == null) continue;
    for (const link of row.trade_strategies) {
      for (const strategy of link.strategies) {
        if (!strategy?.name) continue;
        (byStrategyMap.get(strategy.name) ?? byStrategyMap.set(strategy.name, []).get(strategy.name)!).push(
          row.risk_percent,
        );
      }
    }
  }

  return {
    ...buildRiskReport(rows),
    byStrategy: Array.from(byStrategyMap.entries())
      // The same floor as every other segmented figure in the app.
      .filter(([, risks]) => risks.length >= MIN_SEGMENT_TRADES)
      .map(([strategy, risks]) => ({ strategy, risk: spread(risks) }))
      .sort((a, b) => (b.risk.median ?? 0) - (a.risk.median ?? 0)),
  };
}
