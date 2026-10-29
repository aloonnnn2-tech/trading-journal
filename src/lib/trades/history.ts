import type { SupabaseClient } from "@supabase/supabase-js";
import type { Trade, TradeCoreFields } from "./types";
import { computeDerivedFields } from "./compute";
import { resultForClosedTrade } from "./result";

// "Column doesn't exist": PGRST204 from PostgREST for an unknown column in a
// write payload, 42703 from raw Postgres. See updateTrade for why this
// matters during the manual-migration window.
const MISSING_COLUMN_CODES = new Set(["PGRST204", "42703"]);
const isMissingColumn = (error: { code?: string }) => MISSING_COLUMN_CODES.has(error.code ?? "");

export interface TradeHistoryEntry {
  id: string;
  createdAt: string;
  snapshot: Trade;
}

export async function listTradeHistory(
  supabase: SupabaseClient,
  tradeId: string,
): Promise<TradeHistoryEntry[]> {
  const { data, error } = await supabase
    .from("trade_history")
    .select("id, created_at, snapshot")
    .eq("trade_id", tradeId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data as { id: string; created_at: string; snapshot: Trade }[]).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    snapshot: row.snapshot,
  }));
}

// Restoring writes the snapshot's columns straight back onto the trade.
// This update itself fires the snapshot_trade_history trigger (migration
// 0008), so the pre-restore state is preserved too -- a restore is just
// another entry in the same history, not a destructive rewind.
export async function restoreTradeVersion(
  supabase: SupabaseClient,
  tradeId: string,
  historyId: string,
): Promise<Trade> {
  // Scoped by trade_id too, not just id -- otherwise a historyId that
  // belongs to a different trade (still the same user, so RLS alone
  // wouldn't catch it) would restore onto the wrong trade.
  const { data: historyRow, error: historyError } = await supabase
    .from("trade_history")
    .select("snapshot")
    .eq("id", historyId)
    .eq("trade_id", tradeId)
    .maybeSingle();
  if (historyError) throw historyError;
  if (!historyRow) throw new Error("History entry not found for this trade");

  const snapshot = historyRow.snapshot as Trade;
  const { id: _id, user_id: _userId, created_at: _createdAt, updated_at: _updatedAt, ...rest } = snapshot;

  // The fee chosen back then may have been deleted since. The live row lost
  // it through `on delete set null` (0056), but the snapshot still names it,
  // and writing a vanished id back fails the foreign key -- the restore would
  // error out. Such a trade goes back to automatic matching instead.
  const ruleId = (rest as { commission_rule_id?: string | null }).commission_rule_id;
  if (ruleId) {
    const { data: rule } = await supabase.from("commission_rules").select("id").eq("id", ruleId).maybeSingle();
    if (!rule) (rest as { commission_rule_id?: string | null }).commission_rule_id = null;
  }

  // A version from before partial sells (0079) had none. Restoring it takes
  // today's sales off too -- left on, the row would keep sales its restored
  // P&L ignores.
  const assumedNoSales = !Object.prototype.hasOwnProperty.call(rest, "partial_exits");
  if (assumedNoSales) (rest as { partial_exits?: unknown }).partial_exits = [];

  // Re-derive P&L from the restored values instead of trusting the snapshot's
  // stored dollar_pl. A snapshot taken before commissions existed carries a
  // *gross* dollar_pl and no commission key at all -- writing that back
  // verbatim would leave a gross P&L sitting next to whatever commission the
  // row currently has, which is a number that never existed. Recomputing
  // makes the restored row internally consistent no matter how old the
  // snapshot is.
  const commission =
    rest.commission != null && Number.isFinite(Number(rest.commission)) ? Number(rest.commission) : null;
  const derived = computeDerivedFields({ ...(rest as unknown as TradeCoreFields), commission });
  // `result` has to be re-derived for the same reason dollar_pl is: the
  // snapshot's stored result was decided against whatever P&L existed when
  // it was taken, so restoring a pre-commission "win" whose gross profit is
  // thinner than the fee now owed would write "win" next to a negative
  // dollar_pl. resultForClosedTrade is the single source of truth for that
  // mapping (see result.ts -- it's what every write path uses).
  const restored = {
    ...rest,
    commission,
    ...derived,
    ...(rest.status === "closed" ? { result: resultForClosedTrade(derived.dollar_pl) } : {}),
  };

  const { data, error } = await supabase
    .from("trades")
    .update(restored)
    .eq("id", tradeId)
    .select()
    .single();
  if (!error) return data as Trade;

  // Same pre-migration window as updateTrade: the commission columns only
  // exist once 0022 has been applied by hand.
  if (!isMissingColumn(error)) throw error;

  // Or 0079 isn't applied: there are no sales to take off.
  if (assumedNoSales) {
    const { partial_exits: _sales, ...withoutSales } = restored as typeof restored & { partial_exits?: unknown };
    const again = await supabase.from("trades").update(withoutSales).eq("id", tradeId).select().single();
    if (!again.error) return again.data as Trade;
    if (!isMissingColumn(again.error)) throw again.error;
    delete (rest as { partial_exits?: unknown }).partial_exits;
  }

  const grossDerived = computeDerivedFields({
    ...(rest as unknown as TradeCoreFields),
    commission: null,
  });
  const withoutCommission: Record<string, unknown> = {
    ...rest,
    ...grossDerived,
    ...(rest.status === "closed" ? { result: resultForClosedTrade(grossDerived.dollar_pl) } : {}),
  };
  delete withoutCommission.commission;
  delete withoutCommission.commission_manual;

  const retry = await supabase
    .from("trades")
    .update(withoutCommission)
    .eq("id", tradeId)
    .select()
    .single();
  if (retry.error) throw retry.error;
  return retry.data as Trade;
}
