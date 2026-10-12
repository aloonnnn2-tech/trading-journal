-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
--
-- ORDER: apply AFTER the code that writes events with the service-role
-- client is live (src/lib/tracking/log.ts). Applied before it, the old code's
-- event inserts are refused -- silently, since logging is best-effort -- so
-- activity between this migration and the deploy is simply not recorded.
-- Nothing else breaks either way.
--
-- Full check, 2026-10-12, finding N-1: users could write the analytics
-- tables directly.
--
--   analytics_events  "insert own" (0013) let any signed-in user insert rows
--                     straight through Supabase with the anon key every
--                     browser holds -- skipping /api/analytics/track, its rate
--                     limit and the event registry it enforces (F-16). Any
--                     event name, any props, as many rows as they liked: made-up
--                     activity in the admin feed and an unbounded table.
--   analytics_sessions "insert own" / "update own" (0013) let a user set any
--                     duration or last-seen time on their own sessions.
--   record_heartbeat  (0045) is the user-callable way the tracker credits
--                     time, +30 s per call. Called in a loop it credited hours
--                     in seconds.
--
-- After this:
--   - events are written only by server code, with the service-role client,
--     after a route has authenticated the caller and validated the event;
--   - sessions are written only by record_heartbeat (security definer), which
--     now credits 30 s only when at least 25 s have passed since the session's
--     last beat. The tracker beats every 30 s while the tab is visible
--     (HEARTBEAT_INTERVAL_MS in src/components/analytics-tracker.tsx), so real
--     beats are never dropped, while a loop credits about real time at most.
-- The admin "select" policies stay: admins still read both tables.

drop policy if exists "analytics_events insert own" on public.analytics_events;
revoke insert, update, delete on public.analytics_events from anon, authenticated;

drop policy if exists "analytics_sessions insert own" on public.analytics_sessions;
drop policy if exists "analytics_sessions update own" on public.analytics_sessions;
revoke insert, update, delete on public.analytics_sessions from anon, authenticated;

create or replace function record_heartbeat(p_session_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The session's owner is taken from the JWT, never from an argument, so a
  -- caller can only ever create or extend their own row.
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into analytics_sessions (id, user_id, duration_seconds, started_at, last_seen_at)
  values (p_session_id, auth.uid(), 0, now(), now())
  on conflict (id) do update
    -- 30 seconds must match HEARTBEAT_INTERVAL_MS in
    -- src/components/analytics-tracker.tsx, the client's beat interval.
    -- Credited only after 25 s since the last beat (0066): a caller looping
    -- this function gets no more than real elapsed time.
    set duration_seconds = analytics_sessions.duration_seconds
          + case when analytics_sessions.last_seen_at <= now() - interval '25 seconds' then 30 else 0 end,
        last_seen_at = case when analytics_sessions.last_seen_at <= now() - interval '25 seconds'
                            then now() else analytics_sessions.last_seen_at end
    -- Guards against a caller passing someone else's session id: the row is
    -- simply not updated rather than the beat being credited to them.
    where analytics_sessions.user_id = auth.uid();
end;
$$;

revoke all on function record_heartbeat(text) from public;
grant execute on function record_heartbeat(text) to authenticated;

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0066_analytics_server_writes.sql')
on conflict do nothing;
