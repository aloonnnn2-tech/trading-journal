import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Activity, Clock, MousePointerClick, Sparkles, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/auth";
import { getUserDetail, getUserDirectory, isAdmin } from "@/lib/tracking/admin-queries";
import { formatDate, formatDateTime } from "@/lib/dates/format";
import { StatCard } from "@/components/ui/StatCard";
import { Card } from "@/components/ui/Card";
import { StaggerGrid } from "@/components/motion/StaggerGrid";
import { AdminTabs } from "../../admin-tabs";
import { formatActive, formatRelative } from "../format";

export const metadata: Metadata = {
  title: "User — Admin",
  robots: { index: false },
};

// Plain-language names for the event vocabulary, so the feature list reads
// "Trades created" rather than "trade_created". Anything unlisted falls back
// to the raw name, so a new event shows up rather than vanishing.
const EVENT_LABELS: Record<string, string> = {
  trade_created: "Trades created",
  trade_edited: "Trades edited",
  trade_deleted: "Trades deleted",
  import_used: "Imports",
  export_used: "Exports",
  ai_question_answered: "AI questions answered",
  ai_review_generated: "AI reviews generated",
  ai_key_added: "AI keys added",
  screenshot_parsed: "Screenshots scanned",
  account_transaction_added: "Cash entries added",
  account_transaction_deleted: "Cash entries deleted",
  commissions_recalculated: "Commission recalculations",
  login: "Logins",
  signup_completed: "Signed up",
  session_start: "Sessions started",
  page_view: "Page views",
  click: "Clicks",
};

// The raw plumbing events are shown in their own sections, not in the
// feature list, where they would drown the meaningful actions.
const PLUMBING = new Set(["click", "page_view", "session_start"]);

function labelFor(eventName: string): string {
  return EVENT_LABELS[eventName] ?? eventName;
}

// A compact, safe rendering of event props for the timeline. These are ids,
// paths and click labels by construction; still, cap the length so one odd
// row can't stretch the table.
function describeProps(props: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === "") continue;
    parts.push(`${k}: ${String(v)}`);
  }
  const s = parts.join(" · ");
  return s.length > 90 ? `${s.slice(0, 87)}…` : s;
}

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewerId = await requireUserId();
  const supabase = await createClient();

  const admin = await isAdmin(supabase, viewerId);
  if (!admin) redirect("/dashboard");

  // The directory row gives the headline numbers; the detail RPC gives the
  // breakdowns. Both are one round-trip each and run together.
  const [directory, detail] = await Promise.all([getUserDirectory(supabase), getUserDetail(supabase, id, 90)]);
  const user = directory.find((u) => u.id === id);
  if (!user) notFound();

  const features = detail.eventCounts.filter((e) => !PLUMBING.has(e.eventName));

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-6 sm:p-8">
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
            <span>Joined {formatDate(user.signedUpAt)}</span>
            <span aria-hidden>·</span>
            <span>Last seen {formatRelative(user.lastActiveAt)}</span>
          </p>
        </div>
        <p className="text-xs text-zinc-500">Breakdowns cover the last 90 days · counts and timestamps only</p>
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
                  <span className="text-zinc-700 dark:text-zinc-300">{labelFor(e.eventName)}</span>
                  <span className="tabular-nums font-medium text-zinc-900 dark:text-zinc-100">{e.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card hoverable={false} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Most clicked</h2>
          {detail.topClicks.length === 0 ? (
            <p className="text-sm text-zinc-500">No clicks recorded yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-subtle">
              {detail.topClicks.map((c) => (
                <li key={c.label} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                  <span className="min-w-0 truncate font-mono text-xs text-zinc-700 dark:text-zinc-300" title={c.label}>
                    {c.label}
                  </span>
                  <span className="shrink-0 tabular-nums font-medium text-zinc-900 dark:text-zinc-100">{c.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

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

      <Card hoverable={false} className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Recent activity</h2>
        {detail.recentEvents.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <tbody>
                {detail.recentEvents.map((e, i) => (
                  <tr key={`${e.createdAt}-${i}`} className="border-b border-zinc-100 last:border-0 dark:border-subtle">
                    <td className="whitespace-nowrap py-1.5 pr-4 text-xs tabular-nums text-zinc-500">
                      {formatDateTime(e.createdAt)}
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-4 text-zinc-900 dark:text-zinc-100">
                      {labelFor(e.eventName)}
                    </td>
                    <td className="py-1.5 font-mono text-xs text-zinc-500">{describeProps(e.props)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
