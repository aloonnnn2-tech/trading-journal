import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { buildExcursionReport, type ExcursionReport, type ExcursionTrade } from "./aggregate";
import { listExcursions } from "./queries";

/**
 * The MAE/MFE report over every closed trade, assembled from the stored
 * excursion rows. Lifted out of the analytics page so the AI tools and the
 * page share one definition of the report.
 *
 * Read-only: it never triggers a recompute (that fetches from Yahoo and
 * writes), so a tool call can never spend network or mutate anything.
 * Degrades to "nothing computed" until migration 0035 is applied.
 */
export async function getExcursionReport(supabase: SupabaseClient): Promise<ExcursionReport> {
  const [trades, rows] = await Promise.all([
    fetchAllRows<{
      id: string;
      dollar_pl: number | null;
      entry_price: number | null;
      exit_price: number | null;
      stop_loss: number | null;
      direction: string | null;
      trade_strategies: { strategies: { name: string }[] }[];
    }>((from, to) =>
      supabase
        .from("trades")
        .select("id, dollar_pl, entry_price, exit_price, stop_loss, direction, trade_strategies(strategies(name))")
        .eq("status", "closed")
        .not("exit_date", "is", null)
        .neq("mode", "investment")
        .order("id", { ascending: true })
        .range(from, to),
    ),
    listExcursions(supabase).catch(() => []),
  ]);

  const mapped: ExcursionTrade[] = trades.map((t) => ({
    id: t.id,
    dollar_pl: t.dollar_pl,
    entry_price: t.entry_price,
    exit_price: t.exit_price,
    stop_loss: t.stop_loss,
    direction: t.direction,
    strategies: t.trade_strategies
      .flatMap((link) => link.strategies)
      .map((x) => x?.name)
      .filter((n): n is string => typeof n === "string"),
  }));
  return buildExcursionReport(mapped, rows);
}
