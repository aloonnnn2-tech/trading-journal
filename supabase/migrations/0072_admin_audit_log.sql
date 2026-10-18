-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it (live project, and the dev project for the tests). Until it is,
-- the app runs exactly as before: writing an audit entry fails quietly and
-- is logged, never the action itself.
--
-- 0072: an audit trail for admin and data-export actions (security gaps
-- pass, item 1.6). Who did what, to what, when -- nothing else:
--   - admin page views, plan changes, analytics exclusions, featured
--     reviews, waitlist exports and removals;
--   - a user exporting their own account data.
-- Never trade contents, notes, emails or secrets: `target` is an id or a
-- path, `detail` a few small flags (src/lib/admin/audit.ts enforces it).
--
-- Written ONLY by the server through the service role. RLS is on with no
-- policies and every privilege is revoked from anon and authenticated, so
-- no user -- admin included -- can read or forge an entry through the API.
-- Read it in the SQL editor:
--   select * from admin_audit_log order by created_at desc limit 100;

create table if not exists admin_audit_log (
  id bigint generated always as identity primary key,
  -- Deliberately no foreign key: an entry must outlive the account that
  -- made it (deleting your account must not erase what an admin did).
  actor_id uuid not null,
  action text not null check (char_length(action) between 1 and 64),
  target text check (target is null or char_length(target) <= 200),
  detail jsonb check (detail is null or pg_column_size(detail) <= 2048),
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_idx on admin_audit_log (created_at desc);
create index if not exists admin_audit_log_actor_idx on admin_audit_log (actor_id, created_at desc);

alter table admin_audit_log enable row level security;
revoke all on table admin_audit_log from anon, authenticated;

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0072_admin_audit_log.sql')
on conflict do nothing;
