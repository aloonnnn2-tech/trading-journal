import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/supabase/auth";
import { recordAudit } from "@/lib/admin/audit";
import { isAdmin } from "@/lib/tracking/admin-queries";
import { listWaitlist, WAITLIST_PAGE_CAP, type WaitlistEntry } from "@/lib/waitlist/admin-queries";
import { Card } from "@/components/ui/Card";
import { AdminTabs } from "../admin-tabs";
import { WaitlistTable } from "./waitlist-table";

export const metadata: Metadata = {
  title: "Waitlist — Admin",
  robots: { index: false },
};

// The paid-plan waitlist (Phase 2B), readable in the app rather than only in
// the Supabase dashboard -- Alon asked for it on 2026-09-27. The table is
// service-role only (migration 0050), so this page is the one place in the
// app that shows it, behind the same admin gate as the other admin tabs.
export default async function AdminWaitlistPage() {
  const userId = await requireUserId();
  const supabase = await createClient();

  // Checked against the RLS client before any service-role client exists.
  // isAdmin() fails closed on any error.
  if (!(await isAdmin(supabase, userId))) redirect("/dashboard");
  await recordAudit({ actorId: userId, action: "admin_page_view", target: "/admin/waitlist" });

  let entries: WaitlistEntry[] = [];
  let total = 0;
  let problem: "config" | "table" | null = null;
  try {
    ({ entries, total } = await listWaitlist(createAdminClient()));
  } catch (error) {
    // No service-role key is a deployment gap; a missing table means 0050
    // hasn't been applied. Either way: say which, don't 500.
    const code = (error as { code?: string } | null)?.code;
    problem = code === "PGRST205" || code === "42P01" ? "table" : "config";
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-5 sm:p-8">
      <AdminTabs active="waitlist" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Waitlist</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            People who asked to hear when the paid plan launches, from the form on the homepage&apos;s
            paid card. The privacy policy promises removal on request.
          </p>
        </div>
        {!problem && total > 0 && (
          <a
            href="/api/admin/waitlist"
            download
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:border-primary/50 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-zinc-100"
          >
            Download CSV
          </a>
        )}
      </div>

      {problem === "table" ? (
        <Card className="text-sm text-zinc-500" hoverable={false}>
          The waitlist table doesn&apos;t exist yet. Apply <code>supabase/migrations/0050_waitlist.sql</code>{" "}
          in the Supabase SQL editor.
        </Card>
      ) : problem === "config" ? (
        <Card className="text-sm text-zinc-500" hoverable={false}>
          The waitlist can&apos;t be read: <code>SUPABASE_SERVICE_ROLE_KEY</code> is not set. It&apos;s still
          visible in the Supabase table editor.
        </Card>
      ) : (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            <span className="tnum font-mono font-semibold text-zinc-900 dark:text-zinc-50">
              {total.toLocaleString("en-US")}
            </span>{" "}
            {total === 1 ? "person" : "people"} on the waitlist
            {total > WAITLIST_PAGE_CAP && (
              <> &middot; showing the newest {WAITLIST_PAGE_CAP.toLocaleString("en-US")}</>
            )}
          </p>
          <WaitlistTable initialEntries={entries} />
        </>
      )}
    </div>
  );
}
