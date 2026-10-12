import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Whether a signed-in account still has to confirm it is 18+ and accept the
 * Terms and Privacy Policy (Alon, 2026-10-09: existing users re-confirm).
 *
 * True when either timestamp from migration 0061 is missing -- accounts made
 * before the sign-up checkbox, or by a script. FAILS OPEN on any error,
 * including 0061 not being applied: a missing column must never lock every
 * user out of the app behind a prompt they cannot complete.
 */
export async function needsConsent(supabase: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("user_settings")
      .select("age_confirmed_at, terms_accepted_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return false;
    return !data.age_confirmed_at || !data.terms_accepted_at;
  } catch {
    return false;
  }
}
