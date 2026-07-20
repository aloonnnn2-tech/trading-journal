import type { SupabaseClient } from "@supabase/supabase-js";
import type { Strategy, StrategyBreakdown } from "./types";

export async function listStrategies(supabase: SupabaseClient): Promise<Strategy[]> {
  const { data, error } = await supabase
    .from("strategies")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data as Strategy[];
}

export async function getStrategy(supabase: SupabaseClient, id: string): Promise<Strategy | null> {
  const { data, error } = await supabase.from("strategies").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as Strategy | null;
}

export async function createStrategy(
  supabase: SupabaseClient,
  userId: string,
  input: { name: string; description?: string | null; color?: string | null },
): Promise<Strategy> {
  const { data, error } = await supabase
    .from("strategies")
    .insert({
      user_id: userId,
      name: input.name,
      description: input.description ?? null,
      color: input.color ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Strategy;
}

export async function updateStrategy(
  supabase: SupabaseClient,
  id: string,
  changes: Partial<Pick<Strategy, "name" | "description" | "color" | "sort_order">>,
): Promise<Strategy> {
  const { data, error } = await supabase
    .from("strategies")
    .update(changes)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Strategy;
}

// Returns whether a row was actually deleted, so the route can 404 rather
// than report success for an id that didn't exist (or belonged to another
// user and was silently filtered out by RLS).
export async function deleteStrategy(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await supabase.from("strategies").delete().eq("id", id).select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function listTradeStrategyIds(
  supabase: SupabaseClient,
  tradeId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("trade_strategies")
    .select("strategy_id")
    .eq("trade_id", tradeId);
  if (error) throw error;
  return data.map((row) => row.strategy_id as string);
}

// Replaces the full set of strategies a trade uses in one call -- same
// validate-then-swap shape as setTradeFolders in lib/folders/queries.ts.
export async function setTradeStrategies(
  supabase: SupabaseClient,
  tradeId: string,
  strategyIds: string[],
): Promise<void> {
  strategyIds = Array.from(new Set(strategyIds));

  if (strategyIds.length > 0) {
    const { data: validStrategies, error: validateError } = await supabase
      .from("strategies")
      .select("id")
      .in("id", strategyIds);
    if (validateError) throw validateError;
    if ((validStrategies?.length ?? 0) !== strategyIds.length) {
      throw new Error("One or more strategies were not found");
    }
  }

  const { error: deleteError } = await supabase
    .from("trade_strategies")
    .delete()
    .eq("trade_id", tradeId);
  if (deleteError) throw deleteError;

  if (strategyIds.length === 0) return;

  const { error: insertError } = await supabase
    .from("trade_strategies")
    .insert(strategyIds.map((strategyId) => ({ trade_id: tradeId, strategy_id: strategyId })));
  if (insertError) throw insertError;
}

// Maps trade_id -> strategy_id[] for every trade owned by the current
// user, used by the Trades list page to display strategy chips without
// an N+1 lookup per row.
export async function listAllTradeStrategyLinks(
  supabase: SupabaseClient,
): Promise<Record<string, string[]>> {
  const { data, error } = await supabase.from("trade_strategies").select("trade_id, strategy_id");
  if (error) throw error;

  const map: Record<string, string[]> = {};
  for (const row of data) {
    const tradeId = row.trade_id as string;
    (map[tradeId] ??= []).push(row.strategy_id as string);
  }
  return map;
}

// Trade count is every trade using the strategy regardless of status --
// tagging an open/pending trade should visibly bump this immediately, not
// wait until the trade closes. Win rate and total P&L stay scoped to
// closed trades, since an open trade has no realized outcome yet; they'd
// otherwise be diluted by trades that haven't resolved. Strategies with
// zero trades still appear (zeroed out) so a freshly created strategy
// shows up on the Strategies page immediately rather than only once it
// has data.
export async function getStrategyBreakdown(supabase: SupabaseClient): Promise<StrategyBreakdown[]> {
  const [strategies, linksResult] = await Promise.all([
    listStrategies(supabase),
    supabase.from("trade_strategies").select("strategy_id, trades(dollar_pl, status)"),
  ]);
  if (linksResult.error) throw linksResult.error;

  // trade_strategies -> trades is many-to-one, so PostgREST embeds it as a
  // single object at runtime -- but supabase-js's untyped client can't
  // express that without generated types and reports it as an array
  // either way, so this normalizes both possible shapes rather than
  // trusting either one.
  const rows = linksResult.data as {
    strategy_id: string;
    trades: { dollar_pl: number | null; status: string } | { dollar_pl: number | null; status: string }[];
  }[];
  const stats = new Map<string, { trades: number; closed: number; wins: number; totalPL: number }>();
  for (const row of rows) {
    const tradeRow = Array.isArray(row.trades) ? row.trades[0] : row.trades;
    const bucket = stats.get(row.strategy_id) ?? { trades: 0, closed: 0, wins: 0, totalPL: 0 };
    bucket.trades += 1;
    if (tradeRow?.status === "closed") {
      const pl = tradeRow.dollar_pl ?? 0;
      bucket.closed += 1;
      if (pl > 0) bucket.wins += 1;
      bucket.totalPL += pl;
    }
    stats.set(row.strategy_id, bucket);
  }

  return strategies.map((strategy) => {
    const s = stats.get(strategy.id) ?? { trades: 0, closed: 0, wins: 0, totalPL: 0 };
    return {
      strategy,
      trades: s.trades,
      winRate: s.closed > 0 ? s.wins / s.closed : null,
      totalPL: s.totalPL,
    };
  });
}
