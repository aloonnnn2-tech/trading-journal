-- Deletes accounts that signed up but never confirmed their email, after a
-- grace period (security gaps pass, 5.5). NOT a migration and NOT scheduled:
-- review it, then run it by hand in the Supabase SQL editor when you choose.
-- Nobody runs it for you.
--
-- On 2026-10-18 live had 11 accounts, 1 unconfirmed and under 7 days old
-- (npm run accounts:summary), so today this would delete nothing.
--
-- An account counts as stale only when ALL of these hold:
--   * its email was never confirmed (email_confirmed_at is null)
--   * it was created more than GRACE_DAYS ago
--   * it never signed in (with confirmation on, it can't have)
--   * it owns no trades and no screenshot files
--   * it is not an admin and not on the paid plan
--
-- HOW TO RUN, in two steps:
--   1. Run only the PREVIEW query below. It prints how many accounts match
--      and their creation dates -- no emails.
--   2. Put that number in `expected` in the DELETE block and run the block.
--      If the number has changed since the preview, it refuses and deletes
--      nothing, so a preview from last week can't delete today's sign-ups.

-- ---------------------------------------------------------------------------
-- 1. PREVIEW (read-only)
-- ---------------------------------------------------------------------------
select count(*) as stale_unconfirmed, min(u.created_at) as oldest, max(u.created_at) as newest
from auth.users u
where u.email_confirmed_at is null
  and u.last_sign_in_at is null
  and u.created_at < now() - interval '7 days'
  and not exists (select 1 from public.trades t where t.user_id = u.id)
  and not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'trade-images' and split_part(o.name, '/', 1) = u.id::text
  )
  and not exists (
    select 1 from public.user_settings s
    where s.user_id = u.id and (s.is_admin or s.plan = 'paid')
  );

-- ---------------------------------------------------------------------------
-- 2. DELETE (set `expected` from the preview first)
-- ---------------------------------------------------------------------------
begin;

do $$
declare
  grace_days constant int := 7;
  expected constant int := -1;  -- <- the preview's count; -1 refuses on purpose
  n int;
begin
  if expected < 0 then
    raise exception 'Set expected to the preview count first. Nothing deleted.';
  end if;

  with stale as (
    select u.id
    from auth.users u
    where u.email_confirmed_at is null
      and u.last_sign_in_at is null
      and u.created_at < now() - make_interval(days => grace_days)
      and not exists (select 1 from public.trades t where t.user_id = u.id)
      and not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'trade-images' and split_part(o.name, '/', 1) = u.id::text
      )
      and not exists (
        select 1 from public.user_settings s
        where s.user_id = u.id and (s.is_admin or s.plan = 'paid')
      )
  ),
  gone as (
    delete from auth.users u using stale where u.id = stale.id returning u.id
  )
  select count(*) into n from gone;

  if n <> expected then
    raise exception 'Expected to delete % accounts, would delete %. Rolled back, nothing deleted.', expected, n;
  end if;
  raise notice 'Deleted % stale unconfirmed account(s).', n;
end;
$$;

commit;
