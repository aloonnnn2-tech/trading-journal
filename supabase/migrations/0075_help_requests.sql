-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
-- Apply after 0074. Safe before the code: nothing reads it until the help
-- form ships, and the form says "unavailable" until it exists.
-- Down: drop table if exists public.help_requests; (loses every request).
--
-- Help requests (2026-10-20): the "Get help" form at /help, open to anyone,
-- signed in or not. Read and answered in /admin/help.
--
-- Same posture as the waitlist (0050), because anyone can write to it:
--   * service role only -- RLS on with NO policies, every grant revoked from
--     anon and authenticated. The only writer is POST /api/help, after its
--     robot check and limits; the only reader is the admin page.
--   * a size check on every column, so one request can't be huge
--   * a ceiling on the whole table, so even a flood that got past every
--     limit in the route stops at the database

create table if not exists public.help_requests (
  id uuid primary key default gen_random_uuid(),
  -- Set only from the verified session, never from the request. Their
  -- requests go with their account.
  user_id uuid references auth.users (id) on delete cascade,
  email text not null check (char_length(email) between 3 and 254),
  name text check (name is null or char_length(name) between 1 and 80),
  topic text not null check (topic in ('account', 'bug', 'feature', 'paid_plan', 'other')),
  message text not null check (char_length(message) between 10 and 4000),
  -- Where the form was opened from, for context. A path on this site.
  page text check (page is null or char_length(page) <= 200),
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  created_at timestamptz not null default now(),
  handled_at timestamptz
);

create index if not exists help_requests_created_idx on public.help_requests (created_at desc);
create index if not exists help_requests_status_idx on public.help_requests (status, created_at desc);
create index if not exists help_requests_user_idx on public.help_requests (user_id) where user_id is not null;

alter table public.help_requests enable row level security;
revoke all on public.help_requests from anon, authenticated;

-- The whole table, not per account: most requests come from people who are
-- signed out. 20,000 is years of real use; the route's own daily ceiling
-- (src/lib/help/limits.ts) is far below it.
create or replace function public.help_requests_table_cap()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.help_requests) > 20000 then
    raise exception 'Row limit reached: help_requests allows at most 20000 rows.'
      using errcode = '54000';
  end if;
  return null;
end;
$$;

drop trigger if exists help_requests_table_cap on public.help_requests;
create trigger help_requests_table_cap
  after insert on public.help_requests
  for each statement execute function public.help_requests_table_cap();

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0075_help_requests.sql')
on conflict do nothing;
