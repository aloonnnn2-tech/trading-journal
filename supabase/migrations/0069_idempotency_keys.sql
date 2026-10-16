-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
--
-- ORDER: any time. The code that uses this table (src/lib/http/idempotency.ts)
-- works without it: until the table exists, every request simply runs, as
-- before.
--
-- DOWN: `drop table if exists idempotency_keys;` -- nothing else depends on it,
-- and dropping it only returns creates to "a repeat runs twice".
--
-- Production readiness item 25. Creating a trade, duplicating one, and
-- importing a file are not safe to repeat: a double click or a retried
-- request made two trades, or imported the whole file twice. The page now
-- sends an Idempotency-Key header (one random key per user action); the first
-- request with a key runs and its answer is kept here for a day, and a repeat
-- of the same key gets that answer back instead of running again.

create table if not exists idempotency_keys (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Client-generated (crypto.randomUUID()), so scoped per user: one user's
  -- key can never replay another's answer.
  key text not null check (length(key) between 8 and 100),
  -- Which route the key was used on; the same key on another route is refused.
  route text not null,
  -- Null while the first request is still running.
  status int,
  body jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

create index if not exists idempotency_keys_created_at on idempotency_keys (created_at);

-- RLS on with NO policies, and no grants: only the server (service role)
-- reads or writes it, after the route has authenticated the user. Same
-- posture as rate_limit_counters (0042).
alter table idempotency_keys enable row level security;
revoke all on table idempotency_keys from anon, authenticated;

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0069_idempotency_keys.sql')
on conflict do nothing;
