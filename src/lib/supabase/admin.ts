import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client for server-only operations the anon key can't do
// (e.g. auth.admin.deleteUser). Never import this from client components
// or anything bundled to the browser -- the key bypasses RLS entirely.
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
