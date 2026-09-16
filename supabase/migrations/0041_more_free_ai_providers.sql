-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically -- see
-- supabase/migrations/*.sql for the existing convention.
--
-- Adds three more AI providers, all with a usable free tier: Mistral AI,
-- SambaNova Cloud and GitHub Models. All three speak the OpenAI-compatible
-- /chat/completions API, so they share the one adapter in
-- src/lib/ai-keys/providers/openai-compatible.ts rather than getting an
-- integration each.
--
-- Two constraints pin the allowed provider strings, and BOTH must be widened
-- or half the flow breaks: user_api_keys (0030) gates storing a key, and
-- ai_provider_consents (0031) gates recording that the user agreed to send
-- their journal to that provider. They must stay in sync with AI_PROVIDERS in
-- src/lib/ai-keys/types.ts and the zod enum built from it.
--
-- Widening a check constraint only *permits* more values; existing rows are
-- unaffected, so this is safe to apply at any time (ideally before the code
-- that offers the new providers, or a key save will hit the old constraint).

-- The constraint names are the ones Postgres generates for an inline column
-- check on each table. `if exists` keeps this re-runnable and tolerant of a
-- differently-named constraint, which would then need dropping by hand --
-- check with:
--   select conname from pg_constraint where conrelid = 'user_api_keys'::regclass;
--   select conname from pg_constraint where conrelid = 'ai_provider_consents'::regclass;

alter table user_api_keys
  drop constraint if exists user_api_keys_provider_check;

alter table user_api_keys
  add constraint user_api_keys_provider_check
  check (provider in (
    'openai', 'anthropic', 'google', 'groq', 'openrouter', 'cerebras',
    'mistral', 'sambanova', 'github'
  ));

alter table ai_provider_consents
  drop constraint if exists ai_provider_consents_provider_check;

alter table ai_provider_consents
  add constraint ai_provider_consents_provider_check
  check (provider in (
    'openai', 'anthropic', 'google', 'groq', 'openrouter', 'cerebras',
    'mistral', 'sambanova', 'github'
  ));

-- Self-records per the convention in 0040_schema_migrations.sql. Missing on
-- this file's first release -- caught by `npm run migrations:status` showing
-- it PENDING despite both constraints being live -- so this insert was added
-- after the fact and the live database's tracking row was corrected directly.
insert into schema_migrations (filename)
values ('0041_more_free_ai_providers.sql')
on conflict do nothing;
