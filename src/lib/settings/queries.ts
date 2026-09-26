import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EditableCoreField } from "@/lib/trades/types";
import { DEFAULT_DASHBOARD_LAYOUT, type DashboardLayout } from "@/lib/dashboard/layout";
import { DEFAULT_PLAN, type UserPlan } from "./plan";

export interface UserSettings {
  hidden_core_fields: EditableCoreField[];
  dashboard_layout: DashboardLayout;
  timezone: string | null;
  has_completed_tour: boolean;
  /** The paid-plan tour offer is finished with. See src/lib/tour/paid-offer.ts.
   *  Null when migration 0049 has not been applied yet -- see the note on
   *  PAID_TOUR_COLUMNS below. */
  paid_tour_dismissed: boolean | null;
  /** "Later" on that offer: hidden until this passes. Null when never snoozed
   *  OR when 0049 has not been applied. */
  paid_tour_snoozed_until: string | null;
  plan: UserPlan;
  /** Read here alongside everything else so the root layout, which needs it
   *  for the Admin nav link, does not pay a second round-trip to the same
   *  row. Admin *routes* still guard themselves with isAdmin(); this is only
   *  what decides whether the link is drawn. */
  is_admin: boolean;
}

const DEFAULT_SETTINGS: UserSettings = {
  hidden_core_fields: [],
  dashboard_layout: DEFAULT_DASHBOARD_LAYOUT,
  timezone: null,
  has_completed_tour: false,
  paid_tour_dismissed: false,
  paid_tour_snoozed_until: null,
  plan: DEFAULT_PLAN,
  is_admin: false,
};

// cache() dedupes this within one request, keyed on (client, userId). Every
// page reads settings, and the root layout now does too, so without this the
// same row was fetched twice per navigation -- ~110ms of pure waiting each
// time, measured against this project's Supabase region. With the server
// client itself cache()d, both calls hit the same key and one fetch serves
// the whole render.
/**
 * Is this Supabase error "that column does not exist"?
 *
 * Two codes, not one, because PostgREST reports the same condition
 * differently depending on direction: a SELECT naming a missing column fails
 * in Postgres itself (42703, undefined_column), while an UPDATE or INSERT
 * payload is rejected by PostgREST before it reaches Postgres (PGRST204,
 * "could not find the column in the schema cache"). Checking only the first
 * made every paid-offer write a 500 until migration 0049 was applied.
 */
export function isMissingColumnError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "42703" || code === "PGRST204";
}

// The columns 0049 adds. Selected separately so that a database where 0049
// has not been applied yet still serves every other setting: migrations here
// are applied by hand, so "the code is deployed and the migration is not" is
// a real state the app passes through, not a hypothetical. PostgREST answers
// a select naming a missing column with 42703 and no rows, which without this
// split would blank the whole settings object -- and `plan` lives in it, so
// every paid user would silently read as free until the SQL was run.
const PAID_TOUR_COLUMNS = "paid_tour_dismissed, paid_tour_snoozed_until";

export const getUserSettings = cache(async function getUserSettings(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserSettings> {
  const { data, error } = await supabase
    .from("user_settings")
    .select(`hidden_core_fields, dashboard_layout, timezone, has_completed_tour, plan, is_admin, ${PAID_TOUR_COLUMNS}`)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    // 42703 = undefined_column: 0049 is not applied. Retry without it, and
    // report the two fields as null so the caller knows to fall back to
    // localStorage rather than reading "false" as "the user said no".
    if (isMissingColumnError(error)) {
      const { data: base, error: baseError } = await supabase
        .from("user_settings")
        .select("hidden_core_fields, dashboard_layout, timezone, has_completed_tour, plan, is_admin")
        .eq("user_id", userId)
        .maybeSingle();
      if (baseError) throw baseError;
      if (!base) return { ...DEFAULT_SETTINGS, paid_tour_dismissed: null };
      return {
        ...base,
        is_admin: base.is_admin === true,
        paid_tour_dismissed: null,
        paid_tour_snoozed_until: null,
      } as UserSettings;
    }
    throw error;
  }
  // A missing row falls back to defaults -- which means free, not paid, and
  // not admin. That is the safe direction: the only way to be paid or admin
  // is for the database to say so explicitly. isPaidUser() then re-checks
  // with a strict equality, so an unexpected column value can't grant access
  // either.
  if (!data) return DEFAULT_SETTINGS;
  return { ...data, is_admin: data.is_admin === true };
});

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

/** "Show me", or finishing the tour: never offer it again. */
export async function setPaidTourDismissed(supabase: SupabaseClient, userId: string): Promise<void> {
  const { error } = await supabase
    .from("user_settings")
    .update({ paid_tour_dismissed: true, paid_tour_snoozed_until: null })
    .eq("user_id", userId);
  if (error) throw error;
}

/** "Later": hide it until `until` passes. */
export async function setPaidTourSnoozed(
  supabase: SupabaseClient,
  userId: string,
  until: string,
): Promise<void> {
  const { error } = await supabase
    .from("user_settings")
    .update({ paid_tour_snoozed_until: until })
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
