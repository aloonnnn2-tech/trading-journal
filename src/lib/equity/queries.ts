import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { buildEquityCurve, type EquityCurve, type EquityEvent } from "./build";

/**
 * Closed trades and cash movements merged into one event series, so account
 * growth and trading performance can be told apart.
 *
 * Lifted out of the analytics page so the AI tools read the same series the
 * page renders -- one assembly, one set of filters (closed, non-investment,
 * has an exit date), no chance of the two disagreeing about what "equity"
 * means.
 */
export async function loadEquityEvents(supabase: SupabaseClient): Promise<EquityEvent[]> {
  const [trades, cash] = await Promise.all([
    fetchAllRows<{ exit_date: string; dollar_pl: number | null; r_multiple: number | null }>((from, to) =>
      supabase
        .from("trades")
        .select("exit_date, dollar_pl, r_multiple")
        .eq("status", "closed")
        .not("exit_date", "is", null)
        .neq("mode", "investment")
        .order("exit_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    // Awaited rather than chained: a PostgREST builder is a thenable, not a
    // Promise, so it has no .catch of its own.
    (async () => {
      const result = await supabase.from("account_transactions").select("amount, created_at").order("created_at");
      return (result.data ?? []) as { amount: number; created_at: string }[];
    })().catch(() => [] as { amount: number; created_at: string }[]),
  ]);

  return [
    ...trades.map((t) => ({ at: t.exit_date, pl: t.dollar_pl, r: t.r_multiple })),
    ...cash.map((c) => ({ at: c.created_at, cash: Number(c.amount) })),
  ];
}

export async function getEquityCurve(supabase: SupabaseClient): Promise<EquityCurve> {
  return buildEquityCurve(await loadEquityEvents(supabase));
}
