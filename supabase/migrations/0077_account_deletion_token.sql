-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
-- Apply after 0076, BEFORE the code that uses it: until then the Account
-- page says deletion is unavailable.
-- Down: alter table public.account_deletion_requests drop column if exists token_hash;
--
-- Account deletion, second version (2026-10-20). The first relied on the
-- emailed link signing the person in, which with Supabase's default email
-- only works in the browser that asked, from the newest email -- Alon's real
-- test failed on exactly that. Now the link carries a one-time code that only
-- the email contains; this column keeps its SHA-256, never the code.

alter table public.account_deletion_requests
  add column if not exists token_hash text;

alter table public.account_deletion_requests
  drop constraint if exists account_deletion_requests_token_hash_shape,
  add constraint account_deletion_requests_token_hash_shape check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$');

-- Requests made under the first version have no code and can't be finished;
-- they expire within the hour anyway.
delete from public.account_deletion_requests where token_hash is null;

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0077_account_deletion_token.sql')
on conflict do nothing;
