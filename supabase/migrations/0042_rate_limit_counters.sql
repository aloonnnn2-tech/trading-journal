-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically -- see
-- supabase/migrations/*.sql for the existing convention.
--
-- Turns the application rate limiter into a GLOBAL one. Until now the counters
-- lived in per-serverless-instance memory (src/lib/rate-limit.ts), so a client
-- whose requests spread across warm instances got a proportionally higher
-- effective limit, and every cold start reset the window. This backs the limit
-- with one shared table so the ceiling is real across the whole deployment.
--
-- The limiter FAILS OPEN in the app: if this function is missing (migration not
-- yet applied) or the DB is briefly unreachable, requests are allowed rather
-- than blocked -- a limiter that breaks the app it protects is worse than none.
-- So deploying the code before this migration is applied is harmless; applying
-- it is simply what switches the global ceiling on.

create table if not exists rate_limit_counters (
  -- Server-constructed key, e.g. 'api:<userId>', 'api-anon:<ip>', 'ocr:<userId>'.
  bucket text primary key,
  -- Start of the current fixed window. A bucket's row is reused in place, so
  -- the table grows only with the number of distinct buckets seen, not with
  -- request volume; the nightly prune below drops cold ones.
  window_start timestamptz not null default now(),
  count int not null default 0
);

-- RLS on with NO policies: the table is written and read ONLY through the
-- security-definer function below, never directly by anon/authenticated. Even
-- if it somehow were, RLS denies every direct row access.
alter table rate_limit_counters enable row level security;

-- Supports the opportunistic prune inside the function below.
create index if not exists rate_limit_counters_window_start_idx
  on rate_limit_counters (window_start);

-- One atomic hit against a bucket. Returns whether the request is allowed and,
-- when not, how many seconds until the window resets.
--
-- security definer so it can touch the RLS-locked table as its owner. The one
-- statement is atomic: concurrent hits on the same bucket serialize on the
-- primary-key row via ON CONFLICT, so the count can't race.
create or replace function rate_limit_hit(p_bucket text, p_max int, p_window_seconds int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  w interval := make_interval(secs => p_window_seconds);
  cur_count int;
  cur_start timestamptz;
begin
  insert into rate_limit_counters as r (bucket, window_start, count)
    values (p_bucket, now(), 1)
  on conflict (bucket) do update
    -- Window elapsed -> start a fresh window at 1; otherwise increment.
    set count        = case when r.window_start < now() - w then 1     else r.count + 1 end,
        window_start = case when r.window_start < now() - w then now() else r.window_start end
  returning r.count, r.window_start into cur_count, cur_start;

  -- Opportunistic cleanup: a bucket's row is reused in place, so the table
  -- only grows with distinct buckets (users + IPs + CSP signatures) seen. On
  -- roughly 1% of calls, drop rows whose window ended over a day ago so cold
  -- buckets don't linger forever. Cheap via the window_start index, and rare
  -- enough not to sit on the hot path of every request.
  if random() < 0.01 then
    delete from rate_limit_counters where window_start < now() - interval '1 day';
  end if;

  return jsonb_build_object(
    'allowed', cur_count <= p_max,
    'retry_after_seconds',
      case when cur_count <= p_max then 0
           else greatest(1, ceil(extract(epoch from (cur_start + w - now())))::int)
      end
  );
end;
$$;

-- **Only service_role may call it.** The app's rate-limit module uses the
-- service-role key (server-only). Deliberately NOT granted to anon/authenticated:
-- the anon key ships in the browser bundle, so a public grant would let anyone
-- call rate_limit_hit('api:<victimUserId>', ...) repeatedly and pre-exhaust
-- another user's bucket -- a denial-of-service handed out for free.
revoke all on function rate_limit_hit(text, int, int) from public;
grant execute on function rate_limit_hit(text, int, int) to service_role;

-- Self-records per the convention in 0040_schema_migrations.sql. Missing on
-- this file's first release -- caught by `npm run migrations:status` showing
-- it PENDING despite the function already being live and answering correctly
-- -- so this insert was added after the fact and the live database's
-- tracking row was corrected directly.
insert into schema_migrations (filename)
values ('0042_rate_limit_counters.sql')
on conflict do nothing;
