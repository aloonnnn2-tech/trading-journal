import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/auth";
import { isAdmin } from "@/lib/auth/roles";
import { buildActivity, filterFeed, getActivityRows, type ActivityRow } from "@/lib/tracking/activity";
import { CATEGORY_LABELS } from "@/lib/tracking/events";
import { getUserDirectory } from "@/lib/tracking/admin-queries";
import { Card } from "@/components/ui/Card";
import { AdminTabs } from "../admin-tabs";
import { ActivitySummary, ClicksPanel, ExitsPanel, FeedTable, SessionsTable } from "./activity-parts";

export const metadata: Metadata = {
  title: "Activity — Admin",
  robots: { index: false },
};

// What users are doing, across every account (Problem 1 of the hardening
// brief): a readable feed, sessions with where each ended, where users
// leave, and most clicked. Filters live in the URL, so the page is a plain
// server-rendered form with no client JS.

const WINDOWS = [1, 7, 30, 90] as const;

type Search = { days?: string; user?: string; cat?: string; all?: string; admins?: string; raw?: string };

const SELECT =
  "rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200";

export default async function AdminActivityPage({ searchParams }: { searchParams: Promise<Search> }) {
  const userId = await requireUserId();
  const supabase = await createClient();
  if (!(await isAdmin(supabase, userId))) redirect("/dashboard");

  const sp = await searchParams;
  const days = WINDOWS.includes(Number(sp.days) as (typeof WINDOWS)[number]) ? Number(sp.days) : 7;
  const userFilter = sp.user && /^[0-9a-f-]{36}$/i.test(sp.user) ? sp.user : null;
  const category = sp.cat && sp.cat in CATEGORY_LABELS ? sp.cat : null;
  const includeExcluded = sp.all === "1";
  // Admins are hidden by default too: only admins can open /admin, so their
  // own visits would otherwise show up as "users leave on Admin: Users".
  const includeAdmins = sp.admins === "1";
  const showRaw = sp.raw === "1";

  let rows: ActivityRow[];
  let loadError: string | null = null;
  try {
    rows = await getActivityRows(supabase, { days, userId: userFilter });
  } catch (error) {
    rows = [];
    const code = (error as { code?: string })?.code;
    loadError =
      code === "PGRST202" || code === "42883"
        ? "The activity query isn't installed yet: apply migration 0062_admin_activity.sql."
        : "Couldn't load activity.";
  }

  // Everyone in the window, for the user filter -- before excluded accounts
  // are dropped, so a test account can still be picked on purpose.
  const people = new Map<string, string>();
  for (const r of rows) if (r.userId) people.set(r.userId, r.email ?? r.userId);
  const adminIds = new Set(
    (await getUserDirectory(supabase).catch(() => [])).filter((u) => u.admin).map((u) => u.id),
  );
  // Picking one user on purpose shows them, whatever they are.
  const visible = userFilter
    ? rows
    : rows.filter(
        (r) => (includeExcluded || !r.excluded) && (includeAdmins || !r.userId || !adminIds.has(r.userId)),
      );
  const hiddenCount = rows.length - visible.length;
  const activity = buildActivity(visible, new Date(), { feedLimit: 300 });
  const feed = filterFeed(activity.feed, category).slice(0, 200);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-5 sm:p-8">
      <AdminTabs active="activity" />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Activity</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            What people did, in plain words. Pages and button names only, never anything typed.
          </p>
        </div>
        <ActivitySummary activity={activity} />
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Window
          <select name="days" defaultValue={String(days)} className={SELECT}>
            {WINDOWS.map((d) => (
              <option key={d} value={d}>
                {d === 1 ? "Last 24 hours" : `Last ${d} days`}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          User
          <select name="user" defaultValue={userFilter ?? ""} className={SELECT}>
            <option value="">Everyone</option>
            {[...people].map(([id, email]) => (
              <option key={id} value={id}>
                {email}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Feed shows
          <select name="cat" defaultValue={category ?? ""} className={SELECT}>
            <option value="">Everything</option>
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 pb-2 text-xs text-zinc-500">
          <input type="checkbox" name="all" value="1" defaultChecked={includeExcluded} />
          Include test / excluded accounts
        </label>
        <label className="flex items-center gap-1.5 pb-2 text-xs text-zinc-500">
          <input type="checkbox" name="admins" value="1" defaultChecked={includeAdmins} />
          Include admin accounts (you)
        </label>
        <label className="flex items-center gap-1.5 pb-2 text-xs text-zinc-500">
          <input type="checkbox" name="raw" value="1" defaultChecked={showRaw} />
          Show raw ids (debug)
        </label>
        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white hover:brightness-110 dark:text-zinc-950"
        >
          Apply
        </button>
      </form>

      {loadError && <p className="text-sm text-loss">{loadError}</p>}
      {hiddenCount > 0 && (
        <p className="text-xs text-zinc-500">
          {hiddenCount} events from admin, test or excluded accounts are hidden.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ExitsPanel exits={activity.exits} />
        <ClicksPanel clicks={activity.clicks} showRaw={showRaw} />
      </div>

      <Card hoverable={false} className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Sessions</h2>
          <p className="text-xs text-zinc-500">
            One browser tab, start to finish. &ldquo;Inferred&rdquo; means no exit was reported, so the last page before
            30 quiet minutes is shown.
          </p>
        </div>
        <SessionsTable sessions={activity.sessions.slice(0, 50)} showUser={!userFilter} />
      </Card>

      <Card hoverable={false} className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Feed</h2>
        <FeedTable items={feed} showUser={!userFilter} showRaw={showRaw} />
      </Card>
    </div>
  );
}
