-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
--
-- Which model each saved AI key asks.
--
-- Until now every key of a provider asked the one model hard-coded in
-- src/lib/ai-keys/types.ts, and providers retire models on their own
-- schedule: Cerebras' llama-3.3-70b and Google's gemini-2.0-flash both died
-- that way, taking Ask down for anyone on those keys. Now the app picks the
-- first of its preferred models that the provider's live list still offers,
-- stores it here, and re-picks when it disappears. The user can also choose
-- one from that list.
--
-- Null = not chosen yet (keys saved before this); the app then uses its
-- first choice for the provider, exactly as before. Nothing breaks while this
-- is unapplied -- the key queries fall back to selecting without the column.

alter table user_api_keys
  add column if not exists model text
    check (model is null or (length(model) between 1 and 200));

-- No grant needed: user_api_keys has no column-level grants (unlike
-- user_settings, see 0024), and 0029's owner-only RLS policy covers the new
-- column like every other.

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0053_ai_key_model.sql')
on conflict do nothing;
