import type { SupabaseClient } from "@supabase/supabase-js";

export interface OverviewStats {
  totalUsers: number;
  signupsToday: number;
  dau: number;
  wau: number;
  mau: number;
  avgSessionSecondsToday: number | null;
  medianSessionSecondsToday: number | null;
  /** Accounts hidden from every count here — test-domain or manually flagged. */
  excludedCount: number;
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
  excluded_count: number;
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
    excludedCount: Number(row.excluded_count ?? 0),
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

// ---- Per-user directory (0043) ------------------------------------------

export interface UserDirectoryRow {
  id: string;
  email: string;
  signedUpAt: string;
  plan: "free" | "paid";
  admin: boolean;
  /** Test-domain email or manually flagged (0044) — hidden from every
   *  aggregate but still listed here, so it can be reviewed and toggled. */
  excluded: boolean;
  tradeCount: number;
  openTrades: number;
  closedTrades: number;
  sessionCount: number;
  activeSeconds: number;
  lastActiveAt: string | null;
  eventsTotal: number;
  clicksTotal: number;
  tradesCreated: number;
  tradesEdited: number;
  tradesDeleted: number;
  imports: number;
  aiQuestions: number;
  aiReviews: number;
  exports: number;
}

interface UserDirectoryRaw {
  id: string;
  email: string;
  signed_up_at: string;
  plan: string;
  admin: boolean;
  excluded: boolean;
  trade_count: number;
  open_trades: number;
  closed_trades: number;
  session_count: number;
  active_seconds: number;
  last_active_at: string | null;
  events_total: number;
  clicks_total: number;
  trades_created: number;
  trades_edited: number;
  trades_deleted: number;
  imports: number;
  ai_questions: number;
  ai_reviews: number;
  exports: number;
}

export async function getUserDirectory(supabase: SupabaseClient): Promise<UserDirectoryRow[]> {
  const { data, error } = await supabase.rpc("admin_user_directory");
  if (error) throw error;
  return ((data ?? []) as UserDirectoryRaw[]).map((r) => ({
    id: r.id,
    email: r.email,
    signedUpAt: r.signed_up_at,
    plan: r.plan === "paid" ? "paid" : "free",
    admin: r.admin,
    excluded: r.excluded,
    tradeCount: Number(r.trade_count),
    openTrades: Number(r.open_trades),
    closedTrades: Number(r.closed_trades),
    sessionCount: Number(r.session_count),
    activeSeconds: Number(r.active_seconds),
    lastActiveAt: r.last_active_at,
    eventsTotal: Number(r.events_total),
    clicksTotal: Number(r.clicks_total),
    tradesCreated: Number(r.trades_created),
    tradesEdited: Number(r.trades_edited),
    tradesDeleted: Number(r.trades_deleted),
    imports: Number(r.imports),
    aiQuestions: Number(r.ai_questions),
    aiReviews: Number(r.ai_reviews),
    exports: Number(r.exports),
  }));
}

export interface UserDetail {
  eventCounts: { eventName: string; count: number }[];
  topClicks: { label: string; count: number }[];
  topPages: { path: string; count: number }[];
  recentEvents: { createdAt: string; eventName: string; props: Record<string, unknown> }[];
}

// The RPC returns one jsonb blob (four shapes in one round-trip); this is the
// only place its keys are spelled, so a rename there is a rename here.
export async function getUserDetail(
  supabase: SupabaseClient,
  userId: string,
  days = 90,
): Promise<UserDetail> {
  const { data, error } = await supabase.rpc("admin_user_detail", { p_user_id: userId, p_days: days });
  if (error) throw error;
  const d = (data ?? {}) as {
    event_counts?: { event_name: string; count: number }[];
    top_clicks?: { label: string; count: number }[];
    top_pages?: { path: string; count: number }[];
    recent_events?: { created_at: string; event_name: string; props: Record<string, unknown> }[];
  };
  return {
    eventCounts: (d.event_counts ?? []).map((x) => ({ eventName: x.event_name, count: Number(x.count) })),
    topClicks: (d.top_clicks ?? []).map((x) => ({ label: x.label, count: Number(x.count) })),
    topPages: (d.top_pages ?? []).map((x) => ({ path: x.path, count: Number(x.count) })),
    recentEvents: (d.recent_events ?? []).map((x) => ({
      createdAt: x.created_at,
      eventName: x.event_name,
      props: x.props ?? {},
    })),
  };
}

// ---- Anonymous homepage-visit counter (0043) ------------------------------

export interface PublicViewPoint {
  day: string;
  views: number;
  signups: number;
}

export async function getPublicViews(supabase: SupabaseClient, days = 30): Promise<PublicViewPoint[]> {
  const { data, error } = await supabase.rpc("admin_public_views", { p_days: days });
  if (error) throw error;
  return (data ?? []).map((row: { day: string; views: number; signups: number }) => ({
    day: row.day,
    views: Number(row.views),
    signups: Number(row.signups),
  }));
}

// Flips whether one account's activity counts toward every admin aggregate
// (0044). The RPC itself rechecks is_admin, so this is safe to call with the
// RLS-scoped client -- no service-role client needed, unlike setUserPlan.
export async function setUserExcluded(
  supabase: SupabaseClient,
  userId: string,
  excluded: boolean,
): Promise<void> {
  const { error } = await supabase.rpc("admin_set_user_excluded", {
    p_user_id: userId,
    p_excluded: excluded,
  });
  if (error) throw error;
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
