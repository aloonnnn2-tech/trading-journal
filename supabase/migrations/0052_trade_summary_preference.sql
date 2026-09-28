-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
--
-- A switch for the summary strip above the trade list (Phase 4B). Alon,
-- 2026-09-29: useful, but some traders would rather not see running figures
-- while they work through their list, so Setup -> Settings can turn it off.
-- On by default, so nothing changes for anyone until they choose.

alter table user_settings
  add column if not exists show_trade_summary boolean not null default true;

-- REQUIRED, not optional: 0024 grants this table column by column, so a new
-- user-writable column needs its own grant or writes fail as "permission
-- denied" (see the note in 0049).
grant insert (show_trade_summary) on user_settings to authenticated;
grant update (show_trade_summary) on user_settings to authenticated;

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0052_trade_summary_preference.sql')
on conflict do nothing;
