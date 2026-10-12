-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
-- Safe to apply before or after the code: it only adds two indexes, and an
-- index changes how a query is answered, never what it returns.
--
-- Two indexes for queries that read by user_id but had none to use
-- (performance audit, 2026-10-12). Neither matters at today's size -- live
-- had 585 trade_history rows and 160 sessions -- they keep two reads from
-- growing with every other user's data.
--
-- trade_history (user_id, created_at, id)
--   The mistakes report (src/lib/mistakes/queries.ts: Insights, Goals, the
--   AI tools and the trading report) reads the user's history through RLS
--   alone, ordered by created_at, id. With only the (trade_id, created_at)
--   index, Postgres scanned EVERY user's history to find one user's rows.
--   Measured on a copy of this schema with 900 users x 300 trades (540k
--   history rows): 363 ms as a sequential scan, 2.6 ms with this index.
--
-- analytics_sessions (user_id)
--   The review prompt counts the caller's visits by user_id
--   (src/app/api/reviews/prompt/route.ts), as does the data download.
--   108k sessions: 9.0 ms scanned, 0.14 ms indexed.
--
-- Cost: one more index entry per trade save (history snapshot) and per new
-- session. A plain CREATE INDEX briefly blocks writes to its table while it
-- builds -- milliseconds at this size.

create index if not exists trade_history_user_created_idx
  on public.trade_history (user_id, created_at, id);

create index if not exists analytics_sessions_user_idx
  on public.analytics_sessions (user_id);

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0065_perf_indexes.sql')
on conflict do nothing;
