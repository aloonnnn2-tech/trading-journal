-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
--
-- ORDER: apply AFTER the code that calls record_public_view with the
-- service-role client is live (src/app/api/analytics/public-view/route.ts).
-- Applied before it, the old code's call is refused -- quietly, it's a
-- beacon -- so public-page views between this and the deploy aren't counted.
-- Nothing else is affected. Apply after 0066 and 0067.
--
-- Full check, 2026-10-12, finding N-3: the public page-view counter could be
-- inflated without limit. record_public_view (0043) was granted to anon and
-- authenticated so the route could call it with no session -- which also let
-- anyone call it straight through Supabase with the public anon key, skipping
-- the proxy's per-IP limit and the route entirely.
--
-- Now only the service role can call it, so the one way in is the route,
-- which limits each IP address (60 views an hour) on top of the proxy's
-- general limit. Still nothing about the visitor is stored with the count.

revoke all on function public.record_public_view(text) from public, anon, authenticated;
grant execute on function public.record_public_view(text) to service_role;

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0068_public_view_server_only.sql')
on conflict do nothing;
