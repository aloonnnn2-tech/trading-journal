import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumnError } from "@/lib/settings/queries";

// Whether the Trades page shows its summary strip (Phase 4B), per account,
// set on Setup -> Settings. Migration 0052 adds the column; kept out of
// getUserSettings for the same reason as the demo state -- that loader
// already carries 0049's fallback and every page depends on it.

/** `true`/`false` as stored; `null` when 0052 isn't applied yet, which the
 *  Trades page treats as "show it" and the Settings page explains. */
export async function getShowTradeSummary(supabase: SupabaseClient, userId: string): Promise<boolean | null> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("show_trade_summary")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (isMissingColumnError(error)) return null;
    throw error;
  }
  // A missing row reads as the default. The row exists for every account
  // (0003's trigger), so this is belt and braces.
  return data?.show_trade_summary !== false;
}

/** update(), not upsert(): see the note above setTourCompleted in queries.ts. */
export async function setShowTradeSummary(supabase: SupabaseClient, userId: string, show: boolean): Promise<void> {
  const { error } = await supabase.from("user_settings").update({ show_trade_summary: show }).eq("user_id", userId);
  if (error) throw error;
}
