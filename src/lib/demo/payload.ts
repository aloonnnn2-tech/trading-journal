import { computeDerivedFields } from "@/lib/trades/compute";
import { resultForClosedTrade } from "@/lib/trades/result";
import type { TradeCoreFields } from "@/lib/trades/types";
import journal from "./journal.json";

// Shapes the demo journal (journal.json, built offline from real prices by
// scripts/build-demo-journal.mjs) into what seed_demo_journal (0051) inserts.
//
// Derived figures are computed here with the app's own computeDerivedFields
// and resultForClosedTrade rather than stored in the JSON, so a demo trade's
// P/L, R and result are exactly what the app would compute on saving it --
// editing one in the sandbox can't make its numbers jump. No commission: the
// demo seeds no commission rule, and a fee with no rule behind it would be
// recalculated away on the first edit.

export type DemoJournal = typeof journal;
export type DemoTrade = DemoJournal["trades"][number];

export interface DemoPayload {
  strategies: {
    key: string;
    name: string;
    description: string;
    color: string;
    sort_order: number;
    rules: (DemoJournal["strategies"][number]["rules"][number] & { sort_order: number })[];
  }[];
  trades: {
    key: string;
    strategies: string[];
    row: Record<string, unknown>;
    history: { created_at: string; snapshot: Record<string, unknown> }[];
  }[];
  deposit: { amount: number; note: string; created_at: string };
}

export function demoTradeRow(trade: DemoTrade): Record<string, unknown> {
  const core = { ...trade.row, commission: null } as unknown as TradeCoreFields;
  const derived = computeDerivedFields(core);
  return {
    ...trade.row,
    ...derived,
    commission: null,
    commission_manual: false,
    result: resultForClosedTrade(derived.dollar_pl),
    strategy_field_values: {},
    // As if logged when it was placed and last touched when it closed.
    created_at: trade.row.entry_date,
    updated_at: trade.row.exit_date,
  };
}

export function buildDemoPayload(source: DemoJournal = journal): DemoPayload {
  return {
    strategies: source.strategies.map((s, i) => ({
      key: s.key,
      name: s.name,
      description: s.description,
      color: s.color,
      sort_order: i,
      rules: s.rules.map((r, j) => ({ ...r, sort_order: j })),
    })),
    trades: source.trades.map((t) => ({
      key: t.key,
      strategies: [t.strategy],
      row: demoTradeRow(t),
      history: t.history.map((h) => ({ created_at: h.created_at, snapshot: h.snapshot as Record<string, unknown> })),
    })),
    deposit: {
      amount: source.account.deposit,
      note: source.account.depositNote,
      created_at: source.account.depositAt,
    },
  };
}
