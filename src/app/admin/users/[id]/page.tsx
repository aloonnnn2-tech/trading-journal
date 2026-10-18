import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Activity, Clock, MousePointerClick, Sparkles, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/auth";
import { recordAudit } from "@/lib/admin/audit";
import { getUserDetail, getUserDirectory, isAdmin } from "@/lib/tracking/admin-queries";
import { formatDate } from "@/lib/dates/format";
import { buildActivity, getActivityRows, type ActivityRow } from "@/lib/tracking/activity";
import { countLabelFor } from "@/lib/tracking/events";
import { StatCard } from "@/components/ui/StatCard";
import { Card } from "@/components/ui/Card";
import { StaggerGrid } from "@/components/motion/StaggerGrid";
import { AdminTabs } from "../../admin-tabs";
import { formatActive, formatRelative } from "../format";
import { ClicksPanel, ExitsPanel, FeedTable, SessionsTable } from "../../activity/activity-parts";

export const metadata: Metadata = {
  title: "User — Admin",
  robots: { index: false },
};

// Plumbing events are shown in their own sections (sessions, feed, pages),
// not in the feature list, where they would drown the meaningful actions.
const PLUMBING = new Set(["click", "page_view", "page_exit", "session_start"]);

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewerId = await requireUserId();
  const supabase = await createClient();

  const admin = await isAdmin(supabase, viewerId);
  if (!admin) redirect("/dashboard");
  await recordAudit({ actorId: viewerId, action: "admin_page_view", target: `/admin/users/${id}` });

  // The directory row gives the headline numbers; the detail RPC gives the
  // breakdowns. Both are one round-trip each and run together.
  const [directory, detail] = await Promise.all([getUserDirectory(supabase), getUserDetail(supabase, id, 90)]);
  const user = directory.find((u) => u.id === id);
  if (!user) notFound();

  // The same readable feed as the Activity tab (src/lib/tracking/events.ts).
  // Before migration 0062 the activity query doesn't exist; the detail
  // RPC's recent events still render through the same names then.
  let rows: ActivityRow[];
  let sessionsAvailable = true;
  try {
    rows = await getActivityRows(supabase, { days: 90, userId: id, limit: 2000 });
  } catch {
    sessionsAvailable = false;
    rows = detail.recentEvents.map((e) => ({
      createdAt: e.createdAt,
      userId: id,
      email: user.email,
      excluded: user.excluded,
      sessionId: "",
      eventName: e.eventName,
      props: e.props,
    }));
  }
  const activity = buildActivity(rows, new Date(), { feedLimit: 100 });

  const features = detail.eventCounts.filter((e) => !PLUMBING.has(e.eventName));

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-5 sm:p-8">
      <AdminTabs active="users" />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Link href="/admin/users" className="text-xs text-zinc-500 hover:text-primary">
            ← All users
          </Link>
          <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {user.email}
          </h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-zinc-500">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                user.plan === "paid" ? "bg-profit/10 text-profit" : "bg-zinc-500/10 text-zinc-500"
              }`}
            >
              {user.plan}
            </span>
            {user.admin && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">admin</span>
            )}
            {user.excluded && (
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                excluded from analytics
              </span>
            )}
            <span>Joined {formatDate(user.signedUpAt)}</span>
            <span aria-hidden>·</span>
            <span>Last seen {formatRelative(user.lastActiveAt)}</span>
          </p>
        </div>
        <p className="text-xs text-zinc-500">
          Breakdowns cover the last 90 days · counts and timestamps only
          {user.excluded && " · excluded from every aggregate on the Analytics tab, still shown here for review"}
        </p>
      </div>

      <StaggerGrid className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Trades"
          value={String(user.tradeCount)}
          hint={`${user.openTrades} open · ${user.closedTrades} closed`}
          icon={TrendingUp}
        />
        <StatCard
          label="Active time"
          value={formatActive(user.activeSeconds)}
          hint={`${user.sessionCount} sessions`}
          icon={Clock}
        />
        <StatCard label="Clicks" value={String(user.clicksTotal)} hint="every interactive click" icon={MousePointerClick} />
        <StatCard
          label="AI questions"
          value={String(user.aiQuestions)}
          hint={`${user.aiReviews} reviews`}
          icon={Sparkles}
        />
        <StatCard label="All events" value={String(user.eventsTotal)} hint="everything recorded" icon={Activity} />
      </StaggerGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card hoverable={false} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Features used</h2>
          {features.length === 0 ? (
            <p className="text-sm text-zinc-500">No feature activity in the last 90 days.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-subtle">
              {features.map((e) => (
                <li key={e.eventName} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                  <span className="text-zinc-700 dark:text-zinc-300">{countLabelFor(e.eventName)}</span>
                  <span className="tabular-nums font-medium text-zinc-900 dark:text-zinc-100">{e.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <ClicksPanel clicks={activity.clicks} showRaw={false} />

        <Card hoverable={false} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Most visited pages</h2>
          {detail.topPages.length === 0 ? (
            <p className="text-sm text-zinc-500">No page views recorded yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-subtle">
              {detail.topPages.map((p) => (
                <li key={p.path} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                  <span className="min-w-0 truncate font-mono text-xs text-zinc-700 dark:text-zinc-300" title={p.path}>
                    {p.path}
                  </span>
                  <span className="shrink-0 tabular-nums font-medium text-zinc-900 dark:text-zinc-100">{p.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {sessionsAvailable && (
        <div className="grid gap-4 lg:grid-cols-3">
          <ExitsPanel exits={activity.exits} />
          <Card hoverable={false} className="flex flex-col gap-3 lg:col-span-2">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Sessions</h2>
            <SessionsTable sessions={activity.sessions.slice(0, 20)} showUser={false} />
          </Card>
        </div>
      )}

      <Card hoverable={false} className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Recent activity</h2>
        <FeedTable items={activity.feed} showUser={false} showRaw={false} />
      </Card>
    </div>
  );
}
