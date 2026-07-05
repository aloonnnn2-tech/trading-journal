import type { SupabaseClient } from "@supabase/supabase-js";
import type { Trade } from "./types";

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
  const { data: historyRow, error: historyError } = await supabase
    .from("trade_history")
    .select("snapshot")
    .eq("id", historyId)
    .single();
  if (historyError) throw historyError;

  const snapshot = historyRow.snapshot as Trade;
  const { id: _id, user_id: _userId, created_at: _createdAt, updated_at: _updatedAt, ...rest } = snapshot;

  const { data, error } = await supabase
    .from("trades")
    .update(rest)
    .eq("id", tradeId)
    .select()
    .single();
  if (error) throw error;
  return data as Trade;
}
