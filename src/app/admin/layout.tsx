import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth/roles";

/**
 * Backstop admin gate for everything under /admin (security hardening,
 * Phase 5). A non-admin loading any admin URL is redirected here, even on a
 * page added later that forgot its own check.
 *
 * Only a backstop: Next does not re-run a layout on client-side navigation
 * between its pages (node_modules/next/dist/docs/01-app/02-guides/
 * authentication.md, "Layouts and auth checks"). So every admin page keeps
 * its own isAdmin() check, and src/app/admin/admin-gates.test.ts fails if one
 * is missing. The database re-checks is_admin inside every admin function too.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const userId = await requireUserId();
  if (!(await isAdmin(await createClient(), userId))) redirect("/dashboard");
  return children;
}
