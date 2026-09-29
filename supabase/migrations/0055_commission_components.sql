-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
--
-- Multi-line commission rules and broker presets (Alon, 2026-09-29).
--
-- A 0022 rule is ONE fee line (flat, percent or per share, with a min/max).
-- Real brokers charge several at once: IBKR Pro Fixed is $0.005/share with a
-- $1 minimum and a 1%-of-value cap, PLUS the SEC fee and FINRA's TAF on sells.
-- `components` holds those lines; when it is a non-empty array the app uses
-- it instead of rule_type/amount/applies_to/min_fee/max_fee, which keep
-- describing every existing single-line rule exactly as before.
--
-- The app validates the array with zod (src/lib/commissions/schema.ts) on
-- every write. `preset_id` records which researched broker preset a rule came
-- from (src/lib/commissions/presets.ts), so the UI can show its source and
-- the date its figures were checked.

alter table commission_rules
  add column if not exists components jsonb,
  add column if not exists preset_id text;

-- Bound what can be stored: null, or an array of at most 8 lines, small.
alter table commission_rules
  drop constraint if exists commission_rules_components_shape;
alter table commission_rules
  add constraint commission_rules_components_shape
    check (
      components is null
      or (jsonb_typeof(components) = 'array'
          and jsonb_array_length(components) <= 8
          and pg_column_size(components) <= 8192)
    );

alter table commission_rules
  drop constraint if exists commission_rules_preset_id_length;
alter table commission_rules
  add constraint commission_rules_preset_id_length
    check (preset_id is null or length(preset_id) <= 80);

-- No grant needed: commission_rules has no column-level grants (unlike
-- user_settings, see 0024); 0022's owner-only RLS policy covers these too.

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0055_commission_components.sql')
on conflict do nothing;
