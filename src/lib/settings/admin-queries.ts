import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_PLAN, type UserPlan } from "./plan";

// Admin-only reads/writes of other users' plans.
//
// **Every function here takes a service-role client** (createAdminClient),
// which bypasses RLS entirely. That is not a shortcut -- it is the only thing
// that can do this work:
//   - emails live in `auth.users`, which no anon-key client can select from;
//   - `plan` was deliberately left out of 0024's column grants, so even the
//     row's own owner cannot update it with the anon key. Service-role is the
//     only writer by design (see the long comment in 0029).
//
// Because RLS is off for these calls, the usual safety net is gone. Callers
// MUST prove the requester is an admin (isAdmin() against the RLS client)
// before reaching any of this -- there is no per-row check below that would
// catch a missing authorization check upstream.

export interface AdminUserPlan {
  userId: string;
  email: string | null;
  plan: UserPlan;
  createdAt: string;
}

// One page of the admin user list. Supabase caps listUsers at 1000 per page;
// this app is far below that, so a single generous page keeps the UI a plain
// list with no pagination controls to maintain. If the user count ever
// approaches this, that's the point to add real paging rather than silently
// truncating -- hence `hasMore`, which the page surfaces instead of pretending
// the list is complete.
const PAGE_SIZE = 200;

export async function listUsersWithPlans(
  admin: SupabaseClient,
): Promise<{ users: AdminUserPlan[]; hasMore: boolean }> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: PAGE_SIZE });
  if (error) throw error;

  const authUsers = data.users;
  if (authUsers.length === 0) return { users: [], hasMore: false };

  // Fetch plans for exactly these users rather than the whole table. RLS is
  // off on this client, so an unfiltered select would read every row in the
  // database -- the explicit `.in(...)` is the filter that admin.ts's warning
  // requires of every service-role query.
  const { data: settings, error: settingsError } = await admin
    .from("user_settings")
    .select("user_id, plan")
    .in(
      "user_id",
      authUsers.map((u) => u.id),
    );
  if (settingsError) throw settingsError;

  const planByUserId = new Map<string, UserPlan>(
    (settings ?? []).map((row) => [row.user_id as string, row.plan as UserPlan]),
  );

  return {
    // A user with no settings row yet (the 0003 signup trigger normally
    // creates one, but "normally" isn't "guaranteed") reads as free, matching
    // getUserSettings's fallback. Never assume paid from missing data.
    users: authUsers.map((u) => ({
      userId: u.id,
      email: u.email ?? null,
      plan: planByUserId.get(u.id) ?? DEFAULT_PLAN,
      createdAt: u.created_at,
    })),
    hasMore: authUsers.length === PAGE_SIZE,
  };
}

/**
 * Sets one user's plan. Returns false if no row was updated, which the route
 * turns into a 404.
 *
 * Uses update-then-insert rather than upsert for the same reason
 * setTourCompleted does (see queries.ts): an update matching nothing reports
 * success having written nothing, and silently failing to grant a plan the
 * admin just clicked is exactly the kind of invisible bug that gets debugged
 * as "the paywall is broken".
 */
export async function setUserPlan(
  admin: SupabaseClient,
  userId: string,
  plan: UserPlan,
): Promise<boolean> {
  const { data, error } = await admin
    .from("user_settings")
    .update({ plan })
    // Explicit user_id filter: RLS is off, so without this the update would
    // set every user in the database to this plan.
    .eq("user_id", userId)
    .select("user_id");
  if (error) throw error;
  if ((data?.length ?? 0) > 0) return true;

  // No settings row yet. Insert one carrying the plan -- but only for a real
  // auth user, so a typo'd id can't create an orphan row. The FK to
  // auth.users would reject it anyway; checking first turns a 500 into a 404.
  const { data: authUser, error: lookupError } = await admin.auth.admin.getUserById(userId);
  if (lookupError || !authUser?.user) return false;

  const { error: insertError } = await admin
    .from("user_settings")
    .insert({ user_id: userId, plan });
  if (insertError) throw insertError;
  return true;
}
