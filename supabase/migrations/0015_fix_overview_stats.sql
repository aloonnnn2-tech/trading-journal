-- admin_overview_stats() failed at runtime with:
--   ERROR: structure of query does not match function result type
--   DETAIL: Returned type double precision does not match expected type
--   numeric in column 7.
-- percentile_cont() returns double precision, but the function declares
-- median_session_seconds_today as numeric -- RETURN QUERY requires an
-- exact type match (unlike a plain SELECT, it won't implicitly cast).
-- Explicitly cast the percentile_cont result to numeric to fix.

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
    (select (percentile_cont(0.5) within group (order by duration_seconds))::numeric
       from analytics_sessions where started_at >= date_trunc('day', now()));
end;
$$;

grant execute on function admin_overview_stats() to authenticated;
