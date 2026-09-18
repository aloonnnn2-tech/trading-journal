import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/auth";
import { getUserDirectory, isAdmin, type UserDirectoryRow } from "@/lib/tracking/admin-queries";
import { Card } from "@/components/ui/Card";
import { AdminTabs } from "../admin-tabs";
import { UsersTable } from "./users-table";

export const metadata: Metadata = {
  title: "Users — Admin",
  robots: { index: false },
};

export default async function AdminUsersPage() {
  const userId = await requireUserId();
  const supabase = await createClient();

  // Same gate as the other admin pages. The RPC re-checks is_admin itself,
  // so this redirect is the polite front door, not the lock.
  const admin = await isAdmin(supabase, userId);
  if (!admin) redirect("/dashboard");

  let users: UserDirectoryRow[] = [];
  let migrationMissing = false;
  try {
    users = await getUserDirectory(supabase);
  } catch {
    // The only realistic failure here is migration 0043 not yet applied --
    // the function simply does not exist. Say so rather than 500.
    migrationMissing = true;
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-6 sm:p-8">
      <AdminTabs active="users" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Users</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Every account, with what it has done. Counts and timestamps only — no trade contents,
          notes or figures ever reach this page. Click a row for the full activity breakdown. Not
          linked from the app nav.
        </p>
      </div>

      {migrationMissing ? (
        <Card hoverable={false} className="border-amber-500/40 text-sm text-zinc-700 dark:text-zinc-300">
          This page needs migration <code className="font-mono">0043_admin_users.sql</code> applied
          in the Supabase SQL editor. Run <code className="font-mono">npm run migrations:status</code>{" "}
          to confirm.
        </Card>
      ) : (
        <UsersTable users={users} currentUserId={userId} />
      )}
    </div>
  );
}
