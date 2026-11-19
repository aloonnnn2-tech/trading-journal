import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Whether switching from the demo journal keeps the user's own trades --
 * true once migration 0082 is applied (the demo's rows carry is_demo, and
 * finish_demo_journal removes only those). Before that, the switch clears
 * every trade, so the app must not invite a demo user to log one of their own.
 *
 * Asked of the database rather than assumed: migrations here are applied by
 * hand, and "code deployed, migration not yet run" is a real state. Any error
 * reads as false -- the safe answer.
 */
export async function demoKeepsOwnTrades(supabase: SupabaseClient): Promise<boolean> {
  const { error } = await supabase.from("trades").select("is_demo", { count: "exact", head: true }).limit(1);
  return !error;
}
