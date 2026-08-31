-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically -- see
-- supabase/migrations/*.sql for the existing convention.
--
-- Adds three more AI providers, all with a usable free tier: Groq,
-- OpenRouter and Cerebras. 0029 pinned `provider` to a three-value check
-- constraint, so without this the API would reject them with a constraint
-- violation before any key could be stored.
--
-- All three speak the OpenAI-compatible /chat/completions API, so they share
-- one adapter in src/lib/ai-keys/providers/openai-compatible.ts rather than
-- getting an integration each. This constraint is the database's half of the
-- same list -- it must stay in sync with AI_PROVIDERS in
-- src/lib/ai-keys/types.ts and the zod enum built from it.

-- The constraint name is the one Postgres generates for an inline column
-- check on this table. `if exists` keeps this migration safe to re-run and
-- tolerant of a differently-named constraint, which would then need dropping
-- by hand -- check with:
--   select conname from pg_constraint where conrelid = 'user_api_keys'::regclass;
alter table user_api_keys
  drop constraint if exists user_api_keys_provider_check;

alter table user_api_keys
  add constraint user_api_keys_provider_check
  check (provider in ('openai', 'anthropic', 'google', 'groq', 'openrouter', 'cerebras'));
