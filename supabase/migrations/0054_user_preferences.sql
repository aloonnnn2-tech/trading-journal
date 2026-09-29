-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
--
-- One home for Setup -> Settings switches (Alon, 2026-09-29): trade preview
-- panel, keyboard shortcuts, theme, tour offers, card hover motion.
--
-- A jsonb object rather than a column per switch: 0052 showed that each new
-- boolean column costs a migration, two grants and a missing-column fallback,
-- and the switch list is meant to grow. The app validates the object with one
-- zod schema (src/lib/settings/preferences.ts) on every read and write, and
-- reads anything it doesn't recognise as the default -- so a hand-edited or
-- stale value can never break a page, only fall back.
--
-- show_trade_summary (0052) stays its own column; nothing moves.

alter table user_settings
  add column if not exists preferences jsonb not null default '{}'::jsonb;

-- The row is user-writable (below), so bound what can be put in it. Only an
-- object, and small: every real value is a handful of booleans.
alter table user_settings
  drop constraint if exists user_settings_preferences_shape;
alter table user_settings
  add constraint user_settings_preferences_shape
    check (jsonb_typeof(preferences) = 'object' and pg_column_size(preferences) <= 4096);

-- REQUIRED, not optional: 0024 grants this table column by column, so a new
-- user-writable column needs its own grant or writes fail as "permission
-- denied" (see the note in 0049).
grant insert (preferences) on user_settings to authenticated;
grant update (preferences) on user_settings to authenticated;

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0054_user_preferences.sql')
on conflict do nothing;
