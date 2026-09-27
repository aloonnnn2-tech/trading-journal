-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
--
-- The paid-plan waitlist (Phase 2B of docs/design-audit.md). The paid plan is
-- not on sale; this is where a visitor leaves an email to hear when it is.
-- Nothing reads this table from the app. Alon exports it from the Supabase
-- dashboard, and no email is sent by the app.
--
-- WHO CAN TOUCH IT: only the service role. RLS is on with NO policies, which
-- denies anon and authenticated everything, and the grants are revoked as a
-- second lock -- a policy added by mistake later would still find no grant to
-- act on. The only writer is POST /api/waitlist (src/app/api/waitlist/
-- route.ts), which validates, rate limits, and inserts with the service-role
-- key. Reading happens only in the dashboard.
--
-- THE LIST IS NOT DISCOVERABLE. The unique index is on lower(email) so the
-- same address in different case is one row, and the route answers a
-- duplicate exactly as it answers a new signup, so the endpoint cannot be used
-- to test whether someone is on the list.

create table if not exists waitlist (
  id uuid primary key default gen_random_uuid(),
  -- 254 is the longest a valid address can be (RFC 5321's path limit, minus
  -- the angle brackets). The route rejects longer ones first; this is the
  -- floor under it.
  email text not null check (length(email) <= 254),
  -- Which form it came from, from a fixed allowlist the route enforces
  -- (src/lib/waitlist/validate.ts). Null only if a future form omits it.
  source text,
  created_at timestamptz not null default now()
);

create unique index if not exists waitlist_email_lower_key on waitlist (lower(email));

alter table waitlist enable row level security;

revoke all on table waitlist from anon, authenticated;

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0050_waitlist.sql')
on conflict do nothing;
