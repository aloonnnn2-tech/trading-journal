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
  const { error } = await supabase
    .from("user_settings")
    .update({ has_completed_tour: true })
    .eq("user_id", userId);
  if (error) throw error;
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
  const { data, error } = await supabase
    .from("user_settings")
    .update({ dashboard_layout: layout })
    .eq("user_id", userId)
    .select("dashboard_layout")
    .single();

  if (error) throw error;
  return data.dashboard_layout as DashboardLayout;
}

export async function setCoreFieldHidden(
  supabase: SupabaseClient,
  userId: string,
  field: EditableCoreField,
  hidden: boolean,
): Promise<UserSettings> {
  const current = await getUserSettings(supabase, userId);
  const set = new Set(current.hidden_core_fields);
  if (hidden) set.add(field);
  else set.delete(field);

  const { data, error } = await supabase
    .from("user_settings")
    .update({ hidden_core_fields: Array.from(set) })
    .eq("user_id", userId)
    .select("hidden_core_fields")
    .single();

  if (error) throw error;
  return data as UserSettings;
}
