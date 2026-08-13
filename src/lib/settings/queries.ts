import type { SupabaseClient } from "@supabase/supabase-js";
import type { EditableCoreField } from "@/lib/trades/types";
import { DEFAULT_DASHBOARD_LAYOUT, type DashboardLayout } from "@/lib/dashboard/layout";

export interface UserSettings {
  hidden_core_fields: EditableCoreField[];
  dashboard_layout: DashboardLayout;
  timezone: string | null;
  has_completed_tour: boolean;
}

const DEFAULT_SETTINGS: UserSettings = {
  hidden_core_fields: [],
  dashboard_layout: DEFAULT_DASHBOARD_LAYOUT,
  timezone: null,
  has_completed_tour: false,
};

export async function getUserSettings(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserSettings> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("hidden_core_fields, dashboard_layout, timezone, has_completed_tour")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data ?? DEFAULT_SETTINGS;
}

// These write with update(), not upsert(). 0024_user_settings_column_grants
// granted `user_id` INSERT but deliberately not UPDATE, and PostgREST's
// upsert puts every column of the payload into its ON CONFLICT DO UPDATE SET
// clause -- including user_id -- so an upsert here fails with 42501
// "permission denied for table user_settings". The row always exists: the
// on_auth_user_created_seed_settings trigger (0003) creates it at signup.
export async function setTourCompleted(supabase: SupabaseClient, userId: string): Promise<void> {
  const { data, error } = await supabase
    .from("user_settings")
    .update({ has_completed_tour: true })
    .eq("user_id", userId)
    .select("user_id");
  if (error) throw error;

  // An update that matches nothing is not an error -- it reports success
  // having written nothing. That failure mode is invisible and permanent
  // here: the welcome modal blocks the entire app until it's answered, and
  // answering it would never be recorded, so it would greet the user again
  // at every login. Insert the row instead (0024 grants INSERT on user_id,
  // which is what rules out a plain upsert). getUserSettings already falls
  // back to defaults for a missing row, so this stays consistent with it.
  if ((data?.length ?? 0) === 0) {
    const { error: insertError } = await supabase
      .from("user_settings")
      .insert({ user_id: userId, has_completed_tour: true });
    if (insertError) throw insertError;
  }
}

// Sets the user's IANA timezone the first time the client detects it.
// Only writes when unset, so it never overrides a value the user (or a
// future settings UI) has already established.
export async function setTimezoneIfUnset(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
): Promise<void> {
  const { error } = await supabase
    .from("user_settings")
    .update({ timezone })
    .eq("user_id", userId)
    .is("timezone", null);

  if (error) throw error;
}

export async function setDashboardLayout(
  supabase: SupabaseClient,
  userId: string,
  layout: DashboardLayout,
): Promise<DashboardLayout> {
  // update()+.single() throws (PGRST116) rather than self-healing when the
  // row is missing, unlike setTourCompleted just above -- same fallback,
  // for the same reason: the row is supposed to always exist (0003's
  // signup trigger), but "supposed to" isn't "throw a 500 if it doesn't."
  const { data, error } = await supabase
    .from("user_settings")
    .update({ dashboard_layout: layout })
    .eq("user_id", userId)
    .select("dashboard_layout");
  if (error) throw error;

  if (data.length > 0) return data[0].dashboard_layout as DashboardLayout;

  const { data: inserted, error: insertError } = await supabase
    .from("user_settings")
    .insert({ user_id: userId, dashboard_layout: layout })
    .select("dashboard_layout")
    .single();
  if (insertError) throw insertError;
  return inserted.dashboard_layout as DashboardLayout;
}

export async function setCoreFieldHidden(
  supabase: SupabaseClient,
  userId: string,
  field: EditableCoreField,
  hidden: boolean,
): Promise<EditableCoreField[]> {
  const current = await getUserSettings(supabase, userId);
  const set = new Set(current.hidden_core_fields);
  if (hidden) set.add(field);
  else set.delete(field);
  const hiddenFields = Array.from(set);

  // Same missing-row fallback as setDashboardLayout above. Also narrowed the
  // return type to what this function actually selects and returns --
  // it used to `select("hidden_core_fields")` and hand the result back cast
  // as the full UserSettings, which has three more required fields
  // (dashboard_layout, timezone, has_completed_tour) that were never
  // fetched and so were `undefined` at runtime despite the type claiming
  // otherwise. Nothing in this codebase currently reads those off the
  // response, but the type was a live lie waiting for a caller to trust it.
  const { data, error } = await supabase
    .from("user_settings")
    .update({ hidden_core_fields: hiddenFields })
    .eq("user_id", userId)
    .select("hidden_core_fields");
  if (error) throw error;

  if (data.length > 0) return data[0].hidden_core_fields as EditableCoreField[];

  const { error: insertError } = await supabase
    .from("user_settings")
    .insert({ user_id: userId, hidden_core_fields: hiddenFields });
  if (insertError) throw insertError;
  return hiddenFields;
}
