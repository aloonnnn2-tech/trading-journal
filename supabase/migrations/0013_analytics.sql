-- Self-hosted usage analytics (total users, DAU/WAU/MAU, feature usage,
-- retention) so checking numbers never requires a Netlify redeploy -- the
-- admin dashboard at /admin/analytics queries this data live. See
-- D:\md files\claude7.md for the original brief.
--
-- is_admin lives on user_settings (this project's equivalent of a
-- "profiles" table -- 1:1 with auth.users, already auto-seeded on signup)
-- rather than a new table.

create table analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  session_id text not null,
  event_name text not null,        -- e.g. 'page_view', 'trade_created', 'session_start'
  event_props jsonb default '{}',  -- flexible metadata (page path, trade id, etc.)
  created_at timestamptz default now()
);

create index idx_analytics_user on analytics_events(user_id);
create index idx_analytics_event_name on analytics_events(event_name);
create index idx_analytics_created_at on analytics_events(created_at);

create table analytics_sessions (
  id text primary key,             -- session_id (uuid generated client-side per visit)
  user_id uuid references auth.users(id),
  started_at timestamptz default now(),
  last_seen_at timestamptz default now(),
  duration_seconds int default 0
);

alter table user_settings add column is_admin boolean not null default false;

-- Row Level Security -----------------------------------------------------
-- Regular users may only insert their own events/session rows, never read
-- any rows (their own or others'). Only admins (is_admin = true on their
-- own user_settings row) can read the raw tables; the admin dashboard
-- itself goes through the security-definer RPCs below instead, but the
-- select policy exists too as a defense-in-depth fallback.

alter table analytics_events enable row level security;

create policy "analytics_events insert own"
  on analytics_events for insert
  with check (auth.uid() = user_id);

create policy "analytics_events admin select"
  on analytics_events for select
  using (exists (select 1 from user_settings s where s.user_id = auth.uid() and s.is_admin));

alter table analytics_sessions enable row level security;

create policy "analytics_sessions insert own"
  on analytics_sessions for insert
  with check (auth.uid() = user_id);

-- Needed for the heartbeat upsert (last_seen_at / duration_seconds ticks).
create policy "analytics_sessions update own"
  on analytics_sessions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "analytics_sessions admin select"
  on analytics_sessions for select
  using (exists (select 1 from user_settings s where s.user_id = auth.uid() and s.is_admin));

-- Admin aggregate RPCs -----------------------------------------------------
-- auth.users isn't exposed through PostgREST/RLS, so these run as
-- security definer (same pattern as seed_user_settings() in
-- 0003_user_settings.sql) and each starts with its own admin check --
-- callers can't get real data out of them just by discovering the route,
-- since the page-level redirect in /admin/analytics is not the only gate.

create or replace function admin_overview_stats()
returns table (
  total_users bigint,
  signups_today bigint,
  dau bigint,
  wau bigint,
  mau bigint,
  avg_session_seconds_today numeric,
  median_session_seconds_today numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from user_settings where user_id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;

  return query
  select
    (select count(*) from auth.users),
    (select count(*) from auth.users where created_at >= date_trunc('day', now())),
    (select count(distinct user_id) from analytics_events where created_at >= now() - interval '1 day'),
    (select count(distinct user_id) from analytics_events where created_at >= now() - interval '7 days'),
    (select count(distinct user_id) from analytics_events where created_at >= now() - interval '30 days'),
    (select avg(duration_seconds) from analytics_sessions where started_at >= date_trunc('day', now())),
    (select percentile_cont(0.5) within group (order by duration_seconds)
       from analytics_sessions where started_at >= date_trunc('day', now()));
end;
$$;

create or replace function admin_usage_series(p_days int default 30)
returns table (day date, signups bigint, dau bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from user_settings where user_id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;

  return query
  with days as (
    select generate_series(current_date - (p_days - 1), current_date, interval '1 day')::date as day
  ),
  signups as (
    select created_at::date as day, count(*) as signups
    from auth.users
    group by 1
  ),
  active as (
    select created_at::date as day, count(distinct user_id) as dau
    from analytics_events
    group by 1
  )
  select d.day, coalesce(s.signups, 0), coalesce(a.dau, 0)
  from days d
  left join signups s on s.day = d.day
  left join active a on a.day = d.day
  order by d.day;
end;
$$;

create or replace function admin_feature_usage(p_days int default 30)
returns table (event_name text, count bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from user_settings where user_id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;

  return query
  select e.event_name, count(*) as count
  from analytics_events e
  where e.created_at >= now() - (p_days || ' days')::interval
    and e.event_name not in ('page_view', 'session_start')
  group by e.event_name
  order by count desc
  limit 20;
end;
$$;

create or replace function admin_retention_cohorts(p_weeks int default 8)
returns table (cohort_week date, cohort_size bigint, retained_next_week bigint, retention_pct numeric)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from user_settings where user_id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;

  return query
  with cohorts as (
    select id as user_id, date_trunc('week', created_at)::date as cohort_week
    from auth.users
    where created_at >= now() - (p_weeks || ' weeks')::interval
  ),
  active_weeks as (
    select distinct user_id, date_trunc('week', created_at)::date as active_week
    from analytics_events
  )
  select
    c.cohort_week,
    count(distinct c.user_id) as cohort_size,
    count(distinct case when aw.active_week = c.cohort_week + interval '7 day' then c.user_id end) as retained_next_week,
    round(
      count(distinct case when aw.active_week = c.cohort_week + interval '7 day' then c.user_id end)::numeric
      / nullif(count(distinct c.user_id), 0) * 100, 1
    ) as retention_pct
  from cohorts c
  left join active_weeks aw on aw.user_id = c.user_id
  group by c.cohort_week
  order by c.cohort_week;
end;
$$;
