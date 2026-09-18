-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically -- see
-- supabase/migrations/*.sql for the existing convention.
--
-- Excludes test and demo accounts from admin analytics, two ways:
--
--   1. AUTOMATIC, by email domain. Any address on a reserved test TLD
--      (.test, .invalid, .example, .localhost -- RFC 2606, the same standard
--      the e2e suite's own throwaway addresses already use) is excluded from
--      every aggregate, with no action needed. A tool that creates accounts
--      to test the live signup form on a domain like this is excluded the
--      first time it ever shows up, not just after someone notices it.
--
--   2. MANUAL, via a per-account flag. `user_settings.excluded_from_analytics`
--      covers everything the domain rule cannot -- most importantly this
--      project's own demo@tradinglens.app showcase account, which sits on a
--      real domain and is a deliberate, curated account rather than test
--      junk, but still is not a real user and would skew signup/usage counts.
--      Set once here for that account; toggleable per-account afterward from
--      /admin/users.
--
-- The rewritten functions below are `create or replace` over the ones 0013
-- and 0043 already defined -- same signatures, same return shapes, so no
-- caller (admin-queries.ts) needs to change. Only the WHERE clauses grow a
-- filter. `admin_user_directory` is the one exception: it does not drop
-- excluded rows, it labels them, because the manual toggle needs somewhere
-- to click.

-- NO GRANT FOR THIS COLUMN -- THAT OMISSION IS THE SECURITY CONTROL, same
-- pattern as `is_admin` (0013) and `plan` (0029). A newly added column on a
-- table already under column-level grants starts with zero write privilege;
-- this is settable only through admin_set_user_excluded() below, which
-- checks is_admin itself, or the Supabase dashboard. If `user_settings` ever
-- needs a bare `grant update` restored, do not let `excluded_from_analytics`
-- ride along in that grant's column list -- a user hiding their own account
-- from your analytics is a smaller problem than a user hiding someone else's,
-- but it is still not theirs to decide.
alter table user_settings
  add column if not exists excluded_from_analytics boolean not null default false;

-- The regex is repeated inline in each function below rather than factored
-- into a shared helper: every other admin_* function in this project is
-- fully self-contained with no shared SQL helpers, and one predicate copied
-- six times reads easier than a dependency none of the surrounding code has.
--
--   u.email !~* '@[^@]+\.(test|invalid|example|localhost)$'
--
-- matches "not on a reserved test TLD" -- true for a real address, false for
-- anything@anything.test, .invalid, .example or .localhost.

-- 1. admin_overview_stats() -- now also reports how many accounts it hid, so
--    "Total users: 5" doesn't read as a lower number with no explanation.

-- `create or replace` cannot change a function's OUT-parameter shape (Postgres
-- error 42P13); this one gains `excluded_count`, so the old version must be
-- dropped first. `admin_usage_series`, `admin_feature_usage` and
-- `admin_retention_cohorts` below keep their original return shape -- only
-- their WHERE clauses change -- so `create or replace` is enough for those.
drop function if exists admin_overview_stats();

create or replace function admin_overview_stats()
returns table (
  total_users bigint,
  signups_today bigint,
  dau bigint,
  wau bigint,
  mau bigint,
  avg_session_seconds_today numeric,
  median_session_seconds_today numeric,
  excluded_count bigint
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
  with real_users as (
    select u.id, u.created_at
    from auth.users u
    left join user_settings s on s.user_id = u.id
    where not coalesce(s.excluded_from_analytics, false)
      and u.email !~* '@[^@]+\.(test|invalid|example|localhost)$'
  )
  select
    (select count(*) from real_users),
    (select count(*) from real_users where created_at >= date_trunc('day', now())),
    (select count(distinct e.user_id) from analytics_events e
       join real_users r on r.id = e.user_id
       where e.created_at >= now() - interval '1 day'),
    (select count(distinct e.user_id) from analytics_events e
       join real_users r on r.id = e.user_id
       where e.created_at >= now() - interval '7 days'),
    (select count(distinct e.user_id) from analytics_events e
       join real_users r on r.id = e.user_id
       where e.created_at >= now() - interval '30 days'),
    (select avg(ses.duration_seconds) from analytics_sessions ses
       join real_users r on r.id = ses.user_id
       where ses.started_at >= date_trunc('day', now())),
    -- Bug carried over from 0013, fixed here: percentile_cont() has no
    -- numeric-input overload at all -- only double precision and interval --
    -- so it always returns double precision, which never matched this
    -- column's declared `numeric`. Postgres error 42804 at execution time.
    -- It stayed silent until a session row with real duration_seconds existed
    -- for "today" at the moment an admin loaded the page, which is exactly
    -- what surfaced it. (A first attempt at this fix cast the SORT KEY to
    -- numeric instead of the result -- that gets silently re-cast back to
    -- double precision to match the only overload that exists, so it changed
    -- nothing. The cast has to land on the aggregate's output.)
    (select (percentile_cont(0.5) within group (order by ses.duration_seconds))::numeric
       from analytics_sessions ses
       join real_users r on r.id = ses.user_id
       where ses.started_at >= date_trunc('day', now())),
    (select count(*) from auth.users) - (select count(*) from real_users);
end;
$$;

-- 2. admin_usage_series() -- signups and DAU per day, same exclusion.

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
  real_users as (
    select u.id, u.created_at
    from auth.users u
    left join user_settings s on s.user_id = u.id
    where not coalesce(s.excluded_from_analytics, false)
      and u.email !~* '@[^@]+\.(test|invalid|example|localhost)$'
  ),
  signups as (
    select created_at::date as day, count(*) as signups
    from real_users
    group by 1
  ),
  active as (
    select e.created_at::date as day, count(distinct e.user_id) as dau
    from analytics_events e
    join real_users r on r.id = e.user_id
    group by 1
  )
  select d.day, coalesce(s.signups, 0), coalesce(a.dau, 0)
  from days d
  left join signups s on s.day = d.day
  left join active a on a.day = d.day
  order by d.day;
end;
$$;

-- 3. admin_feature_usage() -- excluded accounts' clicks and feature use no
--    longer inflate "what gets used".

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
  join auth.users u on u.id = e.user_id
  left join user_settings s on s.user_id = e.user_id
  where e.created_at >= now() - (p_days || ' days')::interval
    and e.event_name not in ('page_view', 'session_start')
    and not coalesce(s.excluded_from_analytics, false)
    and u.email !~* '@[^@]+\.(test|invalid|example|localhost)$'
  group by e.event_name
  order by count desc
  limit 20;
end;
$$;

-- 4. admin_retention_cohorts() -- a hidden account was never eligible to
--    join a cohort in the first place, not merely excluded from the result.

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
    select u.id as user_id, date_trunc('week', u.created_at)::date as cohort_week
    from auth.users u
    left join user_settings s on s.user_id = u.id
    where u.created_at >= now() - (p_weeks || ' weeks')::interval
      and not coalesce(s.excluded_from_analytics, false)
      and u.email !~* '@[^@]+\.(test|invalid|example|localhost)$'
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

-- 5. admin_public_views() -- the visitor-vs-signup funnel excludes hidden
--    accounts from the signup side, the same as everywhere else that counts
--    a signup. Views themselves are anonymous and untouched.

create or replace function admin_public_views(p_days int default 30)
returns table (day date, views bigint, signups bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from user_settings us where us.user_id = auth.uid() and us.is_admin) then
    raise exception 'not authorized';
  end if;

  return query
  with days as (
    select generate_series(current_date - (p_days - 1), current_date, interval '1 day')::date as day
  ),
  v as (
    select pv.day, sum(pv.views)::bigint as views
    from public_page_views pv
    where pv.path = '/'
    group by pv.day
  ),
  s as (
    select u.created_at::date as day, count(*) as signups
    from auth.users u
    left join user_settings us on us.user_id = u.id
    where not coalesce(us.excluded_from_analytics, false)
      and u.email !~* '@[^@]+\.(test|invalid|example|localhost)$'
    group by 1
  )
  select d.day, coalesce(v.views, 0), coalesce(s.signups, 0)
  from days d
  left join v on v.day = d.day
  left join s on s.day = d.day
  order by d.day;
end;
$$;

-- 6. admin_user_directory() -- rows are NOT dropped here. The manual toggle
--    needs an account to click on, so an excluded row still appears, marked,
--    while it disappears from every count and chart above.

-- Same reason as admin_overview_stats() above: this gains an `excluded`
-- output column, so the 0043 version must be dropped before it can be
-- recreated with a different shape.
drop function if exists admin_user_directory();

create or replace function admin_user_directory()
returns table (
  id uuid,
  email text,
  signed_up_at timestamptz,
  plan text,
  admin boolean,
  excluded boolean,
  trade_count bigint,
  open_trades bigint,
  closed_trades bigint,
  session_count bigint,
  active_seconds bigint,
  last_active_at timestamptz,
  events_total bigint,
  clicks_total bigint,
  trades_created bigint,
  trades_edited bigint,
  trades_deleted bigint,
  imports bigint,
  ai_questions bigint,
  ai_reviews bigint,
  exports bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from user_settings us where us.user_id = auth.uid() and us.is_admin) then
    raise exception 'not authorized';
  end if;

  return query
  select
    u.id,
    u.email::text,
    u.created_at,
    coalesce(s.plan, 'free'),
    coalesce(s.is_admin, false),
    coalesce(s.excluded_from_analytics, false)
      or u.email ~* '@[^@]+\.(test|invalid|example|localhost)$',
    coalesce(t.trade_count, 0),
    coalesce(t.open_trades, 0),
    coalesce(t.closed_trades, 0),
    coalesce(ss.session_count, 0),
    coalesce(ss.active_seconds, 0),
    ss.last_active_at,
    coalesce(ev.events_total, 0),
    coalesce(ev.clicks_total, 0),
    coalesce(ev.trades_created, 0),
    coalesce(ev.trades_edited, 0),
    coalesce(ev.trades_deleted, 0),
    coalesce(ev.imports, 0),
    coalesce(ev.ai_questions, 0),
    coalesce(ev.ai_reviews, 0),
    coalesce(ev.exports, 0)
  from auth.users u
  left join user_settings s on s.user_id = u.id
  left join (
    select tr.user_id,
           count(*) as trade_count,
           count(*) filter (where tr.status in ('open', 'pending')) as open_trades,
           count(*) filter (where tr.status = 'closed') as closed_trades
    from trades tr
    group by tr.user_id
  ) t on t.user_id = u.id
  left join (
    select se.user_id,
           count(*) as session_count,
           coalesce(sum(se.duration_seconds), 0)::bigint as active_seconds,
           max(se.last_seen_at) as last_active_at
    from analytics_sessions se
    group by se.user_id
  ) ss on ss.user_id = u.id
  left join (
    select e.user_id,
           count(*) as events_total,
           count(*) filter (where e.event_name = 'click') as clicks_total,
           count(*) filter (where e.event_name = 'trade_created') as trades_created,
           count(*) filter (where e.event_name = 'trade_edited') as trades_edited,
           count(*) filter (where e.event_name = 'trade_deleted') as trades_deleted,
           count(*) filter (where e.event_name = 'import_used') as imports,
           count(*) filter (where e.event_name = 'ai_question_answered') as ai_questions,
           count(*) filter (where e.event_name = 'ai_review_generated') as ai_reviews,
           count(*) filter (where e.event_name = 'export_used') as exports
    from analytics_events e
    group by e.user_id
  ) ev on ev.user_id = u.id
  order by ss.last_active_at desc nulls last, u.created_at desc;
end;
$$;

-- 7. The manual toggle. Anyone with is_admin can flip any account's flag --
--    same authority an admin already has over `plan` via /api/admin/plan.

create or replace function admin_set_user_excluded(p_user_id uuid, p_excluded boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from user_settings us where us.user_id = auth.uid() and us.is_admin) then
    raise exception 'not authorized';
  end if;

  update user_settings
  set excluded_from_analytics = p_excluded
  where user_id = p_user_id;
end;
$$;

revoke all on function admin_set_user_excluded(uuid, boolean) from public;
grant execute on function admin_set_user_excluded(uuid, boolean) to authenticated;

-- 8. Seed: demo@tradinglens.app (id verified live against auth.users before
--    writing this migration) is a deliberate showcase account, not test
--    junk, so the domain rule above does not catch it. Excluded by owner
--    decision, same authority as the toggle above -- this just applies it
--    once instead of requiring a click after the migration runs.
update user_settings
set excluded_from_analytics = true
where user_id = '456454b2-53c2-4252-9ae5-e8f8fe7935c2';

-- Self-records per the convention in 0040_schema_migrations.sql.
insert into schema_migrations (filename)
values ('0044_analytics_exclusions.sql')
on conflict do nothing;
