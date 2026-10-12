-- Deletes the 6 throwaway test accounts found on the live project on
-- 2026-10-10 (docs/cleanup/test-accounts-report.md). NOT a migration: run it
-- once, by hand, in the Supabase SQL editor of the LIVE project.
--
-- BEFORE RUNNING: delete the one test account's screenshot files first
-- (Dashboard -> Storage -> trade-images -> folder
-- 33483ef7-04b5-4e04-adcc-dc997292b6fa -> select it -> Delete). Supabase
-- doesn't allow deleting Storage files from SQL, and this script refuses to
-- run while they are still there, so no file is left without an owner.
--
-- Safe by construction:
--   * explicit ids only, each paired with its exact email; no pattern deletes
--   * refuses (and deletes nothing) unless all 6 still exist with those
--     emails, none is an admin or a paid account, and no files remain
--   * one transaction; the delete must hit exactly 6 rows or it rolls back
-- Every table holding user data cascades from auth.users (checked: all
-- foreign keys to auth.users are ON DELETE CASCADE since 0019), so their
-- trades, events, sessions and settings go with them.
--
-- Afterwards, run 0001_verify_test_accounts_gone.sql (expects no rows), or
-- locally: npm run accounts:list (expects "test 0").

begin;

do $$
declare
  targets constant jsonb := '{
    "33483ef7-04b5-4e04-adcc-dc997292b6fa": "demo+1783024871792@caliunlock-demo.test",
    "bf7b2da4-2751-4534-a8b8-f2d9a35ef79c": "tour-check-1@tradinglens.app",
    "05f90d19-e2d4-4472-a0ce-0fce728be83c": "tour-check-2@tradinglens.app",
    "46868a98-60f5-4dd2-8811-5b7da3e5dfc5": "tour-check-4@tradinglens.app",
    "6a419cef-0917-4c75-91e6-3a0e09798a09": "demo-flow-yes@tradinglens.app",
    "4b87cf48-2cb2-49d9-ae71-21185476807d": "demo-flow-no@tradinglens.app"
  }';
  expected constant int := 6;
  ids uuid[];
  n int;
begin
  select array_agg(key::uuid) into ids from jsonb_each_text(targets);

  -- 1. Every id is still the account it was when listed.
  select count(*) into n
  from auth.users u
  where u.id = any (ids) and lower(u.email) = targets ->> u.id::text;
  if n <> expected then
    raise exception 'Expected % test accounts with the listed emails, found %. Nothing deleted.', expected, n;
  end if;

  -- 2. Never an admin or a paying account.
  if exists (
    select 1 from public.user_settings
    where user_id = any (ids) and (is_admin or plan = 'paid')
  ) then
    raise exception 'A listed account is an admin or on the paid plan. Nothing deleted.';
  end if;

  -- 3. Screenshot files removed first (see the header).
  select count(*) into n
  from storage.objects
  where bucket_id = 'trade-images' and split_part(name, '/', 1) = any (ids::text[]);
  if n > 0 then
    raise exception '% screenshot file(s) still in Storage for these accounts. Delete the folder first (see the header). Nothing deleted.', n;
  end if;

  delete from auth.users where id = any (ids);
  get diagnostics n = row_count;
  if n <> expected then
    raise exception 'Deleted % accounts instead of %; rolled back.', n, expected;
  end if;

  raise notice 'Deleted % test accounts.', n;
end
$$;

commit;
