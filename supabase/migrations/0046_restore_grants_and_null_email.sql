-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically.
--
-- Two small corrections to 0044, neither user-visible today.

-- 1. Restore the execute grants 0044 discarded.
--
-- 0044 had to `drop function` admin_overview_stats() and
-- admin_user_directory() before recreating them, because both gained an
-- output column and `create or replace` cannot change a function's return
-- shape. DROP also discards the function's ACL, and 0044 never put it back,
-- so both silently reverted to Postgres's default of EXECUTE TO PUBLIC --
-- undoing the hardening 0014 and 0043 applied deliberately.
--
-- Not exploitable: each function re-checks is_admin internally and auth.uid()
-- is null for the anon role, so an anonymous call raises 'not authorized'
-- rather than returning data. But the layer is meant to be there, and if this
-- project ever applies `alter default privileges ... revoke execute ... from
-- public` (exactly what 0014 was written to guard against) the missing grant
-- would make both functions uncallable by `authenticated` -- taking out
-- /admin/analytics and /admin/users with a confusing error.
revoke all on function admin_overview_stats() from public;
grant execute on function admin_overview_stats() to authenticated;

revoke all on function admin_user_directory() from public;
grant execute on function admin_user_directory() to authenticated;

-- 2. Treat an account with no email as a real account, not an excluded one.
--
-- Every exclusion predicate in 0044 reads
--     u.email !~* '@[^@]+\.(test|invalid|example|localhost)$'
-- and `NULL !~* ...` evaluates to NULL, not true. So a row with no email
-- fails the WHERE and silently drops out of real_users, the cohorts and the
-- feature usage -- while admin_user_directory computes the inverse and
-- returns `excluded: NULL`, which reaches TypeScript as a falsy value and
-- renders the row as NOT excluded. The aggregates and the directory would
-- therefore disagree about the same account.
--
-- Harmless right now, because this app is email/password only and
-- auth.users.email is always populated. It would switch on silently the day
-- phone or anonymous sign-in is added, which is exactly the kind of thing
-- that is impossible to find later. coalesce() settles it: no email means
-- nothing to match, so the account is ordinary and counts.

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
      and not coalesce(u.email ~* '@[^@]+\.(test|invalid|example|localhost)$', false)
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
    (select (percentile_cont(0.5) within group (order by ses.duration_seconds))::numeric
       from analytics_sessions ses
       join real_users r on r.id = ses.user_id
       where ses.started_at >= date_trunc('day', now())),
    (select count(*) from auth.users) - (select count(*) from real_users);
end;
$$;

revoke all on function admin_overview_stats() from public;
grant execute on function admin_overview_stats() to authenticated;

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
      and not coalesce(u.email ~* '@[^@]+\.(test|invalid|example|localhost)$', false)
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
    and not coalesce(u.email ~* '@[^@]+\.(test|invalid|example|localhost)$', false)
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
    select u.id as user_id, date_trunc('week', u.created_at)::date as cohort_week
    from auth.users u
    left join user_settings s on s.user_id = u.id
    where u.created_at >= now() - (p_weeks || ' weeks')::interval
      and not coalesce(s.excluded_from_analytics, false)
      and not coalesce(u.email ~* '@[^@]+\.(test|invalid|example|localhost)$', false)
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
      and not coalesce(u.email ~* '@[^@]+\.(test|invalid|example|localhost)$', false)
    group by 1
  )
  select d.day, coalesce(v.views, 0), coalesce(s.signups, 0)
  from days d
  left join v on v.day = d.day
  left join s on s.day = d.day
  order by d.day;
end;
$$;

-- admin_user_directory: same coalesce on the inverse expression, so an
-- emailless account reports `excluded = false` rather than NULL and the
-- directory agrees with the aggregates above.
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
      or coalesce(u.email ~* '@[^@]+\.(test|invalid|example|localhost)$', false),
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

revoke all on function admin_user_directory() from public;
grant execute on function admin_user_directory() to authenticated;

-- Self-records per the convention in 0040_schema_migrations.sql.
insert into schema_migrations (filename)
values ('0046_restore_grants_and_null_email.sql')
on conflict do nothing;
