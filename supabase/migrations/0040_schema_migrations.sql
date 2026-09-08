-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. This project has no migration runner -- see the header of every
-- other file in supabase/migrations.
--
-- NEW CONVENTION STARTS HERE: every migration from this one onward MUST end
-- with its own self-recording insert, exactly like the last statement in this
-- file:
--
--     insert into schema_migrations (filename)
--     values ('00NN_description.sql')
--     on conflict do nothing;
--
-- Copy that into every new migration and update the filename. Pasting the
-- file into the SQL editor is then the same act as recording it applied,
-- which is the only reason this table can be trusted -- a separate "remember
-- to also run the insert" step would be forgotten on the first busy day.
-- `on conflict do nothing` makes re-running a file harmless.
--
--
-- WHY THIS TABLE EXISTS. Twenty files (0020 onward) are applied by hand and
-- nothing in the repo records which of them actually reached the live
-- database. "Is 0033 applied?" has so far been answered from memory, and that
-- has already gone wrong once at real cost: scripts/check-rpc-parity.ts
-- exists because the dashboard and the position-size prefill disagreed by
-- $24,212.50 -- a fix had landed in JS while its migration sat unapplied.
--
-- This does NOT introduce a migration runner. Applying SQL stays manual and
-- deliberate; the change is only that the applied/pending split becomes a
-- fact `npm run migrations:status` can check, instead of something a person
-- has to recall. src/lib/supabase/errors.ts (42P01/PGRST205 for a missing
-- table, PGRST204/42703 for a missing column) remains the runtime safety net
-- and is unaffected -- this makes the known state explicit, it does not
-- replace degrading gracefully when that state is wrong.

create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
);

-- LOCKED DOWN, AND THE REVOKE IS NOT OPTIONAL. Supabase ships default
-- privileges granting `anon` and `authenticated` full table access on
-- anything new in `public`, so a bare `create table` here would be reachable
-- through PostgREST the moment it existed. RLS with no policies would return
-- nothing to those roles, but the endpoint itself would still be there,
-- confirming the table's existence and column names to any anonymous caller.
-- Revoking removes the endpoint rather than merely emptying it.
--
-- `service_role` deliberately keeps its grant: it bypasses RLS, and it is how
-- scripts/migrations-status.ts reads this table. Nothing in the app -- no
-- route handler, no client component -- reads or writes it.
revoke all on schema_migrations from anon, authenticated;

-- Enabled with zero policies on purpose: belt to the revoke's braces. If a
-- future migration ever re-grants this table wholesale (0037 notes that
-- `trades` picked up exactly that kind of accidental table-level grant), RLS
-- is the second lock that still denies every non-service-role read.
alter table schema_migrations enable row level security;

-- BACKFILL, WITH HONEST DATES. 0000-0038 were verified live on 4 Sep 2026 by
-- running a real select against each table they create -- these timestamps
-- are that verification date, not the date each file was originally applied,
-- which nobody recorded. 0039 was applied on 7 Sep 2026 and reported as run
-- but never independently re-verified; it is dated accordingly and is the one
-- row here to treat with any suspicion.
--
-- Noon UTC rather than midnight, so the dates read the same in every timezone
-- this project is ever looked at from.
insert into schema_migrations (filename, applied_at)
values
  ('0000_reset.sql',                                     '2026-09-04T12:00:00Z'),
  ('0001_field_definitions_and_trades.sql',              '2026-09-04T12:00:00Z'),
  ('0002_seed_default_fields.sql',                       '2026-09-04T12:00:00Z'),
  ('0003_user_settings.sql',                             '2026-09-04T12:00:00Z'),
  ('0004_folders.sql',                                   '2026-09-04T12:00:00Z'),
  ('0005_search_indexes.sql',                            '2026-09-04T12:00:00Z'),
  ('0006_strategy_tags_field.sql',                       '2026-09-04T12:00:00Z'),
  ('0007_emotion_intensity_field.sql',                   '2026-09-04T12:00:00Z'),
  ('0008_trade_history.sql',                             '2026-09-04T12:00:00Z'),
  ('0009_dashboard_layout.sql',                          '2026-09-04T12:00:00Z'),
  ('0010_trade_images.sql',                              '2026-09-04T12:00:00Z'),
  ('0011_user_timezone.sql',                             '2026-09-04T12:00:00Z'),
  ('0012_trade_images_bucket.sql',                       '2026-09-04T12:00:00Z'),
  ('0013_analytics.sql',                                 '2026-09-04T12:00:00Z'),
  ('0014_analytics_grants.sql',                          '2026-09-04T12:00:00Z'),
  ('0015_fix_overview_stats.sql',                        '2026-09-04T12:00:00Z'),
  ('0016_account_transactions.sql',                      '2026-09-04T12:00:00Z'),
  ('0017_strategies.sql',                                '2026-09-04T12:00:00Z'),
  ('0018_retire_strategy_setup_field.sql',               '2026-09-04T12:00:00Z'),
  ('0019_analytics_cascade_delete.sql',                  '2026-09-04T12:00:00Z'),
  ('0020_dashboard_stats_rpc.sql',                       '2026-09-04T12:00:00Z'),
  ('0021_dashboard_stats_investment_committed_cash.sql', '2026-09-04T12:00:00Z'),
  ('0022_commissions.sql',                               '2026-09-04T12:00:00Z'),
  ('0023_trade_history_retention.sql',                   '2026-09-04T12:00:00Z'),
  ('0024_user_settings_column_grants.sql',               '2026-09-04T12:00:00Z'),
  ('0025_realized_pl_requires_closed.sql',               '2026-09-04T12:00:00Z'),
  ('0026_setup_tie_shows_no_worst.sql',                  '2026-09-04T12:00:00Z'),
  ('0027_committed_cash_includes_pending.sql',           '2026-09-04T12:00:00Z'),
  ('0028_trade_folders_strategies_ownership.sql',        '2026-09-04T12:00:00Z'),
  ('0029_ai_keys_and_plan.sql',                          '2026-09-04T12:00:00Z'),
  ('0030_more_ai_providers.sql',                         '2026-09-04T12:00:00Z'),
  ('0031_ai_provider_consent.sql',                       '2026-09-04T12:00:00Z'),
  ('0032_ai_reviews.sql',                                '2026-09-04T12:00:00Z'),
  ('0033_strategy_rules.sql',                            '2026-09-04T12:00:00Z'),
  ('0034_trade_mistakes_field.sql',                      '2026-09-04T12:00:00Z'),
  ('0035_trade_excursions.sql',                          '2026-09-04T12:00:00Z'),
  ('0036_goals.sql',                                     '2026-09-04T12:00:00Z'),
  ('0037_suggestion_dismissals.sql',                     '2026-09-04T12:00:00Z'),
  ('0038_skip_dismissal_snapshots.sql',                  '2026-09-04T12:00:00Z'),
  ('0039_order_types.sql',                               '2026-09-07T12:00:00Z')
on conflict do nothing;

-- This file records itself, per the convention documented at the top. Note it
-- takes the `now()` default rather than a hardcoded date -- unlike every row
-- above, the moment this runs IS the moment it was applied.
insert into schema_migrations (filename)
values ('0040_schema_migrations.sql')
on conflict do nothing;
