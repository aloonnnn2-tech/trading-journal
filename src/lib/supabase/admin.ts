import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client for server-only operations the anon key can't do:
// `auth.admin.deleteUser` (account deletion) and the scheduled
// auto-execution sweep, which has no user session and must see every user's
// open trades.
//
// Never import this from a client component or anything bundled to the
// browser. **It bypasses Row Level Security entirely**, which means the
// safety net that normally scopes every query to the signed-in user is off:
//  - filter by `user_id` explicitly in every query made with it;
//  - never hand it to a helper that assumes RLS scoping (e.g.
//    `listCommissionRules` without its `userId` argument, which would
//    otherwise load every user's rules);
//  - never reach it from a browser request without an independent
//    authorization check first.
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set -- required for admin operations like account deletion.",
    );
  }

  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
