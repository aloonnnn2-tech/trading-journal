-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it (live project, and the dev project for the tests).
--
-- 0073: Supabase-side gaps from the security gaps pass (Phase 2).
--
-- 1. G-1 (high). rate_limit_hit and prune_click_events are SECURITY DEFINER
--    with no caller check, meant for the service role only. 0042/0043 wrote
--    `revoke ... from public`, but Supabase grants EXECUTE on new functions
--    directly to anon and authenticated, and revoking from PUBLIC doesn't
--    remove those. Confirmed on the dev project: the public anon key could
--    call rate_limit_hit -- and the app-wide market-data ceiling is one
--    fixed bucket ('upstream:yahoo'), so anyone could exhaust it and stop
--    charts and order fills for every user. prune_click_events would let
--    anyone delete click analytics.
--
-- 2. The three admin statistics functions from 0014 were never revoked from
--    PUBLIC. Harmless (each raises "not authorized" for a non-admin), tidied
--    to match every other admin function: authenticated only.
--
-- 3. dashboard_stats and set_updated_at had no fixed search_path (both run
--    as the caller, so low risk; Supabase's linter flags them).
--
-- 4. G-2 (high). Users could upload straight into their own trade-images
--    folder through the Storage API, skipping the app's 4 MB limit, image
--    check, metadata strip, rate limit and row cap -- and such files outlived
--    account deletion. Alon (2026-10-18): close it. Uploads now go only
--    through POST /api/trades/[id]/images, which writes with the service role
--    to a path it builds from the verified user id. Reading (signed URLs) and
--    deleting your own files are unchanged.

-- 1
revoke execute on function rate_limit_hit(text, int, int) from anon, authenticated;
revoke execute on function prune_click_events(int) from anon, authenticated;

-- 2
revoke execute on function admin_usage_series(int) from public, anon;
revoke execute on function admin_feature_usage(int) from public, anon;
revoke execute on function admin_retention_cohorts(int) from public, anon;
grant execute on function admin_usage_series(int) to authenticated;
grant execute on function admin_feature_usage(int) to authenticated;
grant execute on function admin_retention_cohorts(int) to authenticated;

-- 3
alter function dashboard_stats(timestamptz, timestamptz, timestamptz, timestamptz, text)
  set search_path = public, pg_temp;
alter function set_updated_at() set search_path = public, pg_temp;

-- 4
drop policy if exists "trade-images owner insert" on storage.objects;
drop policy if exists "trade-images owner update" on storage.objects;

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0073_close_anon_rpcs_and_direct_uploads.sql')
on conflict do nothing;
