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

export async function setTourCompleted(supabase: SupabaseClient, userId: string): Promise<void> {
  const { error } = await supabase
    .from("user_settings")
    .upsert({ user_id: userId, has_completed_tour: true });
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
    .upsert({ user_id: userId, dashboard_layout: layout })
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
    .upsert({ user_id: userId, hidden_core_fields: Array.from(set) })
    .select("hidden_core_fields")
    .single();

  if (error) throw error;
  return data as UserSettings;
}
