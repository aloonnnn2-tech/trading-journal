import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/supabase/auth";
import { recordAudit } from "@/lib/admin/audit";
import { isAdmin } from "@/lib/tracking/admin-queries";
import { accountEmails, HELP_PAGE_CAP, listHelpRequests, type HelpRequestRow } from "@/lib/help/admin-queries";
import { isMissingTableError } from "@/lib/supabase/errors";
import { Card } from "@/components/ui/Card";
import { AdminTabs } from "../admin-tabs";
import { HelpTable } from "./help-table";

export const metadata: Metadata = {
  title: "Help requests — Admin",
  robots: { index: false },
};

// Requests from the Get help page (/help), anyone's, signed in or not. The
// table is service-role only (0075), so this page is the one place they show,
// behind the same admin gate as the other tabs.
export default async function AdminHelpPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const userId = await requireUserId();
  const supabase = await createClient();

  // Checked against the RLS client before any service-role client exists.
  // isAdmin() fails closed on any error.
  if (!(await isAdmin(supabase, userId))) redirect("/dashboard");
  await recordAudit({ actorId: userId, action: "admin_page_view", target: "/admin/help" });

  const filter = (await searchParams).show === "all" ? "all" : "open";
  let requests: HelpRequestRow[] = [];
  let openCount = 0;
  let accounts: Record<string, string> = {};
  let problem: "config" | "table" | null = null;
  try {
    const admin = createAdminClient();
    ({ requests, openCount } = await listHelpRequests(admin, filter));
    accounts = await accountEmails(admin, requests.flatMap((r) => (r.user_id ? [r.user_id] : [])));
  } catch (error) {
    problem = isMissingTableError(error) ? "table" : "config";
  }

  const tab = (key: "open" | "all", label: string) => (
    <Link
      href={key === "all" ? "/admin/help?show=all" : "/admin/help"}
      className={`rounded-md px-3 py-1.5 text-sm ${
        filter === key ? "bg-primary/10 font-medium text-primary" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-5 sm:p-8">
      <AdminTabs active="help" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Help requests</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Messages from the Get help page. Reply by email, then mark them answered.
        </p>
      </div>

      {problem === "table" ? (
        <Card className="text-sm text-zinc-500" hoverable={false}>
          The help requests table doesn&apos;t exist yet. Apply <code>supabase/migrations/0075_help_requests.sql</code>{" "}
          in the Supabase SQL editor.
        </Card>
      ) : problem === "config" ? (
        <Card className="text-sm text-zinc-500" hoverable={false}>
          Help requests can&apos;t be read: <code>SUPABASE_SERVICE_ROLE_KEY</code> is not set.
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {tab("open", `Open (${openCount.toLocaleString("en-US")})`)}
            {tab("all", "All")}
            {requests.length >= HELP_PAGE_CAP && (
              <span className="text-xs text-zinc-500">Showing the newest {HELP_PAGE_CAP.toLocaleString("en-US")}</span>
            )}
          </div>
          <HelpTable key={filter} initialRequests={requests} accounts={accounts} />
        </>
      )}
    </div>
  );
}
