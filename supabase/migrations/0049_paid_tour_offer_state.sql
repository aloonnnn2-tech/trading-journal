-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
--
-- Where the paid-plan tour offer's dismissal lives.
--
-- The offer ("Everything just unlocked -- a 10-step tour") was stored in
-- localStorage under `tl-paid-tour-offered`, which meant two things. It was
-- per browser, so the same account met it again on a second device after
-- having already said no. And it had one state, dismissed-forever, so
-- "Later" and "Show me" did the same thing -- there was no way to say "not
-- now" and mean it.
--
-- Two columns rather than one, because they are two different facts:
--
--   paid_tour_dismissed       the offer is finished with. Set by "Show me"
--                             and by completing the tour. Never unset.
--   paid_tour_snoozed_until   "Later": hidden until this moment passes.
--                             Null when never snoozed.
--
-- A single nullable timestamptz could encode both with 'infinity', which is
-- shorter and worse: every reader would have to know that convention, and a
-- query for "who is still snoozed" would silently include the people who are
-- done.

alter table user_settings
  add column if not exists paid_tour_dismissed boolean not null default false;

alter table user_settings
  add column if not exists paid_tour_snoozed_until timestamptz;

-- REQUIRED, not optional. 0024_user_settings_column_grants.sql revoked blanket
-- insert/update on this table and re-granted it column by column, because RLS
-- cannot express "you may write your own row but not its is_admin column". A
-- column added after that migration has no grant at all, so writing it fails
-- with "permission denied for table user_settings" -- and the failure is a
-- silent no-op in the UI, not an error anyone sees.
--
-- Anything that adds a user-writable column to this table must come back
-- here. is_admin and excluded_from_analytics stay off both lists deliberately.
grant insert (paid_tour_dismissed, paid_tour_snoozed_until)
  on user_settings to authenticated;

grant update (paid_tour_dismissed, paid_tour_snoozed_until)
  on user_settings to authenticated;

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0049_paid_tour_offer_state.sql')
on conflict do nothing;
