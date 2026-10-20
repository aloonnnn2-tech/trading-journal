-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
-- Apply after 0075. Apply BEFORE the code ships: without this table the
-- Account page can't send a deletion link, so nobody could delete their
-- account (it says so rather than fail silently).
-- Down: drop table if exists public.account_deletion_requests;
--
-- Deleting an account by email confirmation (2026-10-20). Asking to delete
-- records one row here; the emailed link signs the person in; the delete
-- only goes through when that sign-in came from an emailed link AFTER this
-- row was written, and before it expires (src/lib/account/deletion-proof.ts).
--
-- One row per account: asking again replaces it. Service role only -- RLS on
-- with no policies, every grant revoked -- so the browser can neither read
-- nor forge a request; the only writer is POST /api/account/delete/request.

create table if not exists public.account_deletion_requests (
  user_id uuid primary key references auth.users (id) on delete cascade,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint account_deletion_requests_window check (expires_at > requested_at and expires_at <= requested_at + interval '2 hours')
);

alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from anon, authenticated;

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0076_account_deletion_requests.sql')
on conflict do nothing;
