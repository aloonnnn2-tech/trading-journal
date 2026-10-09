import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The app's roles, defined in one place (security hardening, Phase 5).
 *
 *   user   every signed-in account. Authentication itself: src/proxy.ts sets
 *          x-user-id from a verified session, and every route 401s without it.
 *   paid   user_settings.plan = 'paid'. Unlocks the AI features and excursions.
 *   admin  user_settings.is_admin = true. Unlocks /admin and the admin API.
 *
 * `paid` and `admin` are independent flags, not a ladder: an admin is not
 * automatically paid, and the admin pages never need the paid features.
 *
 * Neither flag is writable by its owner -- migrations 0024 and 0029 grant
 * `authenticated` no write on either column, and the IDOR suite proves it
 * (tests/idor/postgrest.idor.test.ts). The only writer of `plan` is the
 * admin-gated /api/admin/plan; `is_admin` is set only in the Supabase
 * dashboard. The database re-checks `is_admin` inside every admin function, so
 * this module is the app's gate, not the only one.
 *
 * FAILS CLOSED everywhere: an unknown plan value, a null, a missing column or
 * a query error all mean "not paid" and "not admin".
 */

export type Role = "user" | "paid" | "admin";

export interface Roles {
  paid: boolean;
  admin: boolean;
}

export const NO_ROLES: Roles = Object.freeze({ paid: false, admin: false });

/** Roles from a settings row the caller already holds. */
export function rolesFrom(settings: { plan?: unknown; is_admin?: unknown } | null | undefined): Roles {
  if (!settings) return NO_ROLES;
  return {
    // Equality, not `!== "free"`: a future or garbled plan value denies.
    paid: settings.plan === "paid",
    admin: settings.is_admin === true,
  };
}

/** Reads the caller's roles. Any failure is NO_ROLES, never a throw. */
export async function getRoles(supabase: SupabaseClient, userId: string): Promise<Roles> {
  try {
    const { data, error } = await supabase
      .from("user_settings")
      .select("plan, is_admin")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return NO_ROLES;
    return rolesFrom(data);
  } catch {
    return NO_ROLES;
  }
}

export function hasRole(roles: Roles, role: Role): boolean {
  if (role === "user") return true;
  return roles[role];
}

export async function isAdmin(supabase: SupabaseClient, userId: string): Promise<boolean> {
  return (await getRoles(supabase, userId)).admin;
}
