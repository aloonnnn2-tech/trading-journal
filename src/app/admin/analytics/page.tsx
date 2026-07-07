import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Users, UserPlus, Activity, CalendarDays, TrendingUp, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  getOverviewStats,
  getUsageSeries,
  getFeatureUsage,
  getRetentionCohorts,
  isAdmin,
} from "@/lib/tracking/admin-queries";
import { StatCard } from "@/components/ui/StatCard";
import { Card } from "@/components/ui/Card";
import { StaggerGrid } from "@/components/motion/StaggerGrid";
import { UsageLineChart } from "./usage-line-chart";
import { FeatureUsageChart } from "./feature-usage-chart";

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
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/sign-in");

  const admin = await isAdmin(supabase, data.user.id);
  if (!admin) redirect("/dashboard");

  const [overview, usageSeries, featureUsage, retention] = await Promise.all([
    getOverviewStats(supabase),
    getUsageSeries(supabase, 30),
    getFeatureUsage(supabase, 30),
    getRetentionCohorts(supabase, 8),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-6 sm:p-8">
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card hoverable={false}>
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
            Signups &amp; active users — last 30 days
          </h2>
          <UsageLineChart data={usageSeries} />
        </Card>

        <Card hoverable={false}>
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
            Feature usage — last 30 days
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
                    {new Date(row.cohortWeek).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
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
