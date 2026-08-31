// Free/paid plan gating.
//
// There is no billing system in this app -- no Stripe, no webhooks, nothing
// that flips this automatically. `plan` is set by hand with the service-role
// key (Supabase dashboard, or the admin-gated route), and 0029 deliberately
// withholds any column grant that would let a user write it themselves. See
// the long comment in 0029_ai_keys_and_plan.sql for why that omission is the
// whole control.

export type UserPlan = "free" | "paid";

export const DEFAULT_PLAN: UserPlan = "free";

/**
 * The single gate for every paid-only route and UI state.
 *
 * Takes `{ plan }` structurally rather than the full `UserSettings` so that
 * callers holding only a plan value (the admin route, tests) can use the same
 * check as the pages holding whole settings -- and so this module doesn't have
 * to import back from queries.ts, which imports it. `UserSettings` satisfies
 * this shape, so every call site reads the same.
 *
 * Fails closed by construction: this is an equality test against "paid", not a
 * `!== "free"` test, so an unrecognized value (a hand-edited row, a future
 * plan tier nobody taught this function about, a `null` from a pre-migration
 * database) denies access rather than granting it. Same posture as isAdmin()
 * in src/lib/tracking/admin-queries.ts.
 */
export function isPaidUser(settings: { plan: UserPlan }): boolean {
  return settings.plan === "paid";
}
