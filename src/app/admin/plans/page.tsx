import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/supabase/auth";
import { isAdmin } from "@/lib/tracking/admin-queries";
import { listUsersWithPlans, type AdminUserPlan } from "@/lib/settings/admin-queries";
import { Card } from "@/components/ui/Card";
import { AdminTabs } from "../admin-tabs";
import { PlanManager } from "./plan-manager";

export const metadata: Metadata = {
  title: "Plans — Admin",
  robots: { index: false },
};

export default async function AdminPlansPage() {
  const userId = await requireUserId();
  const supabase = await createClient();

  // Same gate as /admin/analytics: check against the RLS client before any
  // service-role client exists. isAdmin() fails closed on any error.
  const admin = await isAdmin(supabase, userId);
  if (!admin) redirect("/dashboard");

  let users: AdminUserPlan[] = [];
  let hasMore = false;
  let configError = false;
  try {
    const result = await listUsersWithPlans(createAdminClient());
    users = result.users;
    hasMore = result.hasMore;
  } catch {
    // A missing SUPABASE_SERVICE_ROLE_KEY is a deployment gap, not a crash --
    // render the explanation rather than a 500, matching how the account
    // deletion route degrades.
    configError = true;
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-6 sm:p-8">
      <AdminTabs active="plans" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Plans
        </h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Grant or revoke the paid plan, which unlocks the AI features on Ask Your Journal. There
          is no billing integration — nothing changes these automatically. Not linked from the app
          nav.
        </p>
      </div>

      {configError ? (
        <Card className="text-sm text-zinc-500" hoverable={false}>
          Plan management isn&apos;t configured: <code>SUPABASE_SERVICE_ROLE_KEY</code> is not set.
          Plans can still be changed directly in the Supabase table editor.
        </Card>
      ) : (
        <>
          <PlanManager initialUsers={users} currentUserId={userId} />
          {hasMore && (
            <Card className="text-sm text-zinc-500" hoverable={false}>
              Showing the first 200 users only. Add pagination here before relying on this list
              being complete.
            </Card>
          )}
        </>
      )}
    </div>
  );
}
