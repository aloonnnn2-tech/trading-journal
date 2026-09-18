import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Users, UserPlus, Activity, CalendarDays, TrendingUp, Clock, Eye } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/auth";
import {
  getOverviewStats,
  getUsageSeries,
  getFeatureUsage,
  getRetentionCohorts,
  getPublicViews,
  isAdmin,
  type PublicViewPoint,
} from "@/lib/tracking/admin-queries";
import { StatCard } from "@/components/ui/StatCard";
import { Card } from "@/components/ui/Card";
import { StaggerGrid } from "@/components/motion/StaggerGrid";
import { AdminTabs } from "../admin-tabs";
import { UsageLineChart } from "./usage-line-chart";
import { FeatureUsageChart } from "./feature-usage-chart";
import { VisitsLineChart } from "./visits-line-chart";

// Views and signups over the trailing N days of the series, and the share of
// visits that became an account. A refresh counts as a view, so this is a
// floor on real conversion, not an exact figure -- stated on the card.
function funnel(points: PublicViewPoint[], days: number) {
  const slice = points.slice(-days);
  const views = slice.reduce((n, p) => n + p.views, 0);
  const signups = slice.reduce((n, p) => n + p.signups, 0);
  const pct = views > 0 ? Math.round((signups / views) * 1000) / 10 : null;
  return { views, signups, pct };
}

function funnelHint(f: { views: number; signups: number; pct: number | null }): string {
  if (f.views === 0) return "no visits recorded";
  return `${f.signups} signed up · ${f.pct === null ? "—" : `${f.pct}%`}`;
}

export const metadata: Metadata = {
  title: "Analytics — Admin",
  robots: { index: false },
};

function formatDuration(seconds: number | null): string {
  if (seconds === null || Number.isNaN(seconds)) return "—";
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;
}

export default async function AdminAnalyticsPage() {
  const userId = await requireUserId();
  const supabase = await createClient();

  const admin = await isAdmin(supabase, userId);
  if (!admin) redirect("/dashboard");

  // Public views degrade to empty rather than failing the page: the RPC comes
  // from migration 0043, and every other panel here predates it.
  const [overview, usageSeries, featureUsage, retention, publicViews] = await Promise.all([
    getOverviewStats(supabase),
    getUsageSeries(supabase, 30),
    getFeatureUsage(supabase, 30),
    getRetentionCohorts(supabase, 8),
    getPublicViews(supabase, 30).catch((): PublicViewPoint[] => []),
  ]);
  const today = funnel(publicViews, 1);
  const week = funnel(publicViews, 7);
  const month = funnel(publicViews, 30);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-6 sm:p-8">
      <AdminTabs active="analytics" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Analytics
        </h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Usage across all users, computed live from Supabase. Not linked from the app nav.
        </p>
      </div>

      <StaggerGrid className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <StatCard label="Total users" value={String(overview.totalUsers)} icon={Users} />
        <StatCard label="Signups today" value={String(overview.signupsToday)} icon={UserPlus} />
        <StatCard label="DAU" value={String(overview.dau)} icon={Activity} />
        <StatCard label="WAU" value={String(overview.wau)} icon={CalendarDays} />
        <StatCard label="MAU" value={String(overview.mau)} icon={TrendingUp} />
        <StatCard
          label="Avg time today"
          value={formatDuration(overview.avgSessionSecondsToday)}
          hint={`Median ${formatDuration(overview.medianSessionSecondsToday)}`}
          icon={Clock}
        />
      </StaggerGrid>

      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Homepage visitors</h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          Anonymous views of the homepage against accounts created. Nothing is stored about a
          visitor — no cookie, identifier or IP — so a refresh counts as another view and the
          conversion figure is a floor, not an exact rate.
        </p>
      </div>
      <StaggerGrid className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Views today" value={String(today.views)} hint={funnelHint(today)} icon={Eye} />
        <StatCard label="Views, 7 days" value={String(week.views)} hint={funnelHint(week)} icon={Eye} />
        <StatCard label="Views, 30 days" value={String(month.views)} hint={funnelHint(month)} icon={Eye} />
      </StaggerGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card hoverable={false}>
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
            Homepage views &amp; signups, last 30 days
          </h2>
          <VisitsLineChart data={publicViews} />
        </Card>

        <Card hoverable={false}>
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
            Signups &amp; active users, last 30 days
          </h2>
          <UsageLineChart data={usageSeries} />
        </Card>

        <Card hoverable={false}>
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
            Feature usage, last 30 days
          </h2>
          <FeatureUsageChart data={featureUsage} />
        </Card>
      </div>

      <Card hoverable={false}>
        <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
          Weekly retention
        </h2>
        {retention.length === 0 ? (
          <p className="text-sm text-zinc-500">No cohorts yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                <th className="py-1.5 text-left font-medium">Cohort week</th>
                <th className="py-1.5 text-right font-medium">Signed up</th>
                <th className="py-1.5 text-right font-medium">Back next week</th>
                <th className="py-1.5 text-right font-medium">Retention</th>
              </tr>
            </thead>
            <tbody>
              {retention.map((row) => (
                <tr key={row.cohortWeek} className="border-t border-zinc-100 dark:border-subtle">
                  <td className="py-2 text-zinc-900 dark:text-zinc-100">
                    {new Date(row.cohortWeek).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      // cohortWeek is a plain Postgres `date` -- same UTC-vs-
                      // local fix as usage-line-chart.tsx.
                      timeZone: "UTC",
                    })}
                  </td>
                  <td className="tnum py-2 text-right font-mono text-zinc-600 dark:text-zinc-400">
                    {row.cohortSize}
                  </td>
                  <td className="tnum py-2 text-right font-mono text-zinc-600 dark:text-zinc-400">
                    {row.retainedNextWeek}
                  </td>
                  <td className="tnum py-2 text-right font-mono text-zinc-900 dark:text-zinc-100">
                    {row.retentionPct === null ? "—" : `${row.retentionPct}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
