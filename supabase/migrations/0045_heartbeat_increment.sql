-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically.
--
-- Fixes session time never accumulating for anyone who is not an admin.
--
-- `upsertHeartbeat` did read-then-write: SELECT the row, then UPDATE if found
-- or INSERT if not. But 0013 gives analytics_sessions only three policies --
-- insert-own, update-own, and admin-only SELECT -- and that omission is
-- deliberate: "Regular users may only insert their own events/session rows,
-- never read any rows (their own or others')".
--
-- So for a normal user the SELECT returned nothing on every beat, the code
-- took the INSERT branch every time, and each insert after the first hit the
-- primary key. supabase-js *returns* that error rather than throwing, so the
-- surrounding try/catch never fired and it failed silently, forever.
--
-- Measured before this migration:
--
--     non-admin   42 sessions   41 with duration_seconds = 0   longest 90s
--     admin       73 sessions   15 with duration_seconds = 0   longest 2370s
--
-- Admins accumulated time only because the admin SELECT policy let their own
-- read succeed. The visible damage was the "Active time" column and the
-- avg/median session stats, which showed a dash for every real user.
--
-- The fix deliberately does NOT add a select-own policy, which would undo
-- 0013's privacy decision to make these rows unreadable by their own owner.
-- Instead the increment moves server-side, where it needs no read at all --
-- and becomes atomic, which read-then-write never was: two tabs beating at
-- once could both read the same value and each write back +30, losing one.

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
    -- 30 seconds must match HEARTBEAT_INCREMENT_SECONDS in
    -- src/lib/tracking/log.ts, which is also the client's beat interval.
    -- Changing one without the other makes time-on-site quietly wrong.
    set duration_seconds = analytics_sessions.duration_seconds + 30,
        last_seen_at = now()
    -- Guards against a caller passing someone else's session id: the row is
    -- simply not updated rather than the beat being credited to them. The
    -- first beat of a session inserts 0, so a session's total is always
    -- (beats - 1) * 30, exactly as before.
    where analytics_sessions.user_id = auth.uid();
end;
$$;

revoke all on function record_heartbeat(text) from public;
grant execute on function record_heartbeat(text) to authenticated;

-- Self-records per the convention in 0040_schema_migrations.sql.
insert into schema_migrations (filename)
values ('0045_heartbeat_increment.sql')
on conflict do nothing;
