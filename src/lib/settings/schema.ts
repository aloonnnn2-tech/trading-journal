import { z } from "zod";

// Runtime validator for the admin plan-change payload. Same approach as
// lib/commissions/schema.ts: reject bad values with a clean 400 rather than
// letting them reach Postgres as an unhandled 500 -- which here would be
// 0029's `check (plan in ('free', 'paid'))` firing as a constraint violation.
export const planUpdateSchema = z.object({
  // The *target* user, not the caller. The route re-derives the caller from
  // the auth header and never trusts this field for authorization -- it only
  // names whose row to change, after the caller has been proven an admin.
  userId: z.uuid("userId must be a user id"),
  plan: z.enum(["free", "paid"]),
});
