-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
-- Safe to apply before the code: it only adds a function and two indexes.
--
-- The admin Activity tab (Problem 1 of the hardening brief, 2026-10-09).
--
-- One security-definer function returns raw events in a time window, with
-- the account's email and whether it is excluded from analytics, for all
-- users or one. The app turns them into readable sentences, sessions and
-- "where users leave" (src/lib/tracking/activity.ts). Grouping and wording
-- live in TypeScript, next to the event list (src/lib/tracking/events.ts),
-- rather than in SQL here, so there is one place that knows what an event
-- means.
--
-- Admin-only: the function checks is_admin itself, like every admin_*
-- function since 0013. It returns the same metadata admin_user_detail (0043)
-- already returns for one user (paths, button names, ids, counts), never
-- trade contents.

-- The window scan and the per-session grouping.
create index if not exists analytics_events_created_desc_idx on analytics_events (created_at desc);
create index if not exists analytics_events_user_created_idx on analytics_events (user_id, created_at desc);

create or replace function admin_activity(
  p_days int default 7,
  p_user_id uuid default null,
  p_limit int default 5000
)
returns table (
  created_at timestamptz,
  user_id uuid,
  email text,
  excluded boolean,
  session_id text,
  event_name text,
  event_props jsonb
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
    e.created_at,
    e.user_id,
    u.email::text,
    coalesce(s.excluded_from_analytics, false)
      or coalesce(u.email ~* '@[^@]+\.(test|invalid|example|localhost)$', false),
    e.session_id,
    e.event_name,
    coalesce(e.event_props, '{}'::jsonb)
  from analytics_events e
  left join auth.users u on u.id = e.user_id
  left join user_settings s on s.user_id = e.user_id
  where e.created_at >= now() - make_interval(days => greatest(1, least(p_days, 365)))
    and (p_user_id is null or e.user_id = p_user_id)
  order by e.created_at desc
  limit greatest(1, least(p_limit, 20000));
end;
$$;

revoke all on function admin_activity(int, uuid, int) from public;
grant execute on function admin_activity(int, uuid, int) to authenticated;

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0062_admin_activity.sql')
on conflict do nothing;
