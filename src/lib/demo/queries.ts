import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumnError } from "@/lib/settings/queries";
import { parseDemoState, type DemoState } from "./state";

// Read separately from getUserSettings rather than added to it: that loader
// already carries one migration fallback (0049), and every page depends on
// it. A missing 0051 here costs only the demo, reported as "unavailable".
export const getDemoState = cache(async function getDemoState(
  supabase: SupabaseClient,
  userId: string,
): Promise<DemoState> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("demo_state")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (isMissingColumnError(error)) return "unavailable";
    throw error;
  }
  return parseDemoState(data?.demo_state);
});

/** Whether the account has any trade at all. A head-only count: no rows move. */
export async function hasAnyTrades(supabase: SupabaseClient): Promise<boolean> {
  const { count, error } = await supabase.from("trades").select("id", { count: "exact", head: true });
  if (error) throw error;
  return (count ?? 0) > 0;
}
