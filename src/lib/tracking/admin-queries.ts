import type { SupabaseClient } from "@supabase/supabase-js";

export interface OverviewStats {
  totalUsers: number;
  signupsToday: number;
  dau: number;
  wau: number;
  mau: number;
  avgSessionSecondsToday: number | null;
  medianSessionSecondsToday: number | null;
}

export interface UsagePoint {
  day: string;
  signups: number;
  dau: number;
}

export interface FeatureUsageRow {
  eventName: string;
  count: number;
}

export interface RetentionCohort {
  cohortWeek: string;
  cohortSize: number;
  retainedNextWeek: number;
  retentionPct: number | null;
}

interface OverviewStatsRow {
  total_users: number;
  signups_today: number;
  dau: number;
  wau: number;
  mau: number;
  avg_session_seconds_today: number | null;
  median_session_seconds_today: number | null;
}

export async function getOverviewStats(supabase: SupabaseClient): Promise<OverviewStats> {
  const { data, error } = await supabase.rpc("admin_overview_stats").single();
  if (error) throw error;
  const row = data as OverviewStatsRow;
  return {
    totalUsers: row.total_users,
    signupsToday: row.signups_today,
    dau: row.dau,
    wau: row.wau,
    mau: row.mau,
    avgSessionSecondsToday: row.avg_session_seconds_today,
    medianSessionSecondsToday: row.median_session_seconds_today,
  };
}

export async function getUsageSeries(supabase: SupabaseClient, days = 30): Promise<UsagePoint[]> {
  const { data, error } = await supabase.rpc("admin_usage_series", { p_days: days });
  if (error) throw error;
  return (data ?? []).map((row: { day: string; signups: number; dau: number }) => ({
    day: row.day,
    signups: row.signups,
    dau: row.dau,
  }));
}

export async function getFeatureUsage(supabase: SupabaseClient, days = 30): Promise<FeatureUsageRow[]> {
  const { data, error } = await supabase.rpc("admin_feature_usage", { p_days: days });
  if (error) throw error;
  return (data ?? []).map((row: { event_name: string; count: number }) => ({
    eventName: row.event_name,
    count: row.count,
  }));
}

export async function getRetentionCohorts(supabase: SupabaseClient, weeks = 8): Promise<RetentionCohort[]> {
  const { data, error } = await supabase.rpc("admin_retention_cohorts", { p_weeks: weeks });
  if (error) throw error;
  return (data ?? []).map(
    (row: { cohort_week: string; cohort_size: number; retained_next_week: number; retention_pct: number | null }) => ({
      cohortWeek: row.cohort_week,
      cohortSize: row.cohort_size,
      retainedNextWeek: row.retained_next_week,
      retentionPct: row.retention_pct,
    }),
  );
}

// Fails closed: any error (including the is_admin column not existing yet,
// pre-migration) is treated as "not admin" rather than surfacing a 500 on
// what should just look like an ordinary access-denied redirect.
export async function isAdmin(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("is_admin")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return false;
  return data?.is_admin ?? false;
}
