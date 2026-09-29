import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumnError } from "@/lib/supabase/errors";
import { parsePreferences, type Preferences, type PreferencesPatch } from "./preferences";

// Reads and writes user_settings.preferences (0054). Kept out of
// getUserSettings for the same reason as show_trade_summary: that loader
// carries 0049's fallback and every page depends on it, so a pending
// migration here must not be able to blank it.

/** Full preferences, defaults filled in; `null` while 0054 isn't applied. */
export async function getPreferences(supabase: SupabaseClient, userId: string): Promise<Preferences | null> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("preferences")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (isMissingColumnError(error)) return null;
    throw error;
  }
  return parsePreferences(data?.preferences);
}

/**
 * Merges `patch` into what is stored and returns the result. Read-merge-write
 * rather than a jsonb `||` in SQL: the only writer is this user flipping a
 * switch, so there is no meaningful race, and it keeps the merge in the same
 * validated code path as the read.
 *
 * Throws the missing-column error while 0054 isn't applied; the route turns
 * that into a 503.
 */
export async function savePreferences(
  supabase: SupabaseClient,
  userId: string,
  patch: PreferencesPatch,
): Promise<Preferences> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("preferences")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const next = { ...parsePreferences(data?.preferences), ...patch };
  // update(), not upsert(): see the note above setTourCompleted in queries.ts.
  const { error: writeError } = await supabase.from("user_settings").update({ preferences: next }).eq("user_id", userId);
  if (writeError) throw writeError;
  return next;
}
