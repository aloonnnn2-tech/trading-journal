-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically -- see
-- supabase/migrations/*.sql for the existing convention.
--
-- Records that a user agreed to send their journal to a specific AI provider.
--
-- Replaces a browser-local flag. Two things were wrong with that:
--
--   1. It was keyed by user only, so agreeing to send data to Groq also
--      silently covered a later switch to OpenAI or Google -- providers the
--      user had never been shown, under terms they had never seen. Consent to
--      disclose personal data to one third party is not consent to disclose
--      it to a different one, so the grain has to be per provider.
--
--   2. It lived in localStorage, which means it was per browser rather than
--      per person (a second device asks again), it vanished when site data was
--      cleared, and the app itself held no record that anyone had ever agreed
--      -- exactly the record you want to be able to produce later.
--
-- One row per (user, provider). The row's existence IS the consent; there is
-- deliberately no boolean to get out of sync with it. Withdrawing consent
-- deletes the row, which makes "never agreed" and "changed their mind"
-- identical states -- correct here, because both mean "ask again before
-- sending anything".

create table ai_provider_consents (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Same six values as user_api_keys.provider (0030). Not a foreign key to
  -- anything: consent is about the *provider*, and it must survive the user
  -- deleting and re-adding a key for that provider.
  provider text not null check (provider in ('openai', 'anthropic', 'google', 'groq', 'openrouter', 'cerebras')),

  -- When they agreed. Kept rather than a bare boolean so the record can answer
  -- "when did this happen", which a boolean never can.
  accepted_at timestamptz not null default now(),

  primary key (user_id, provider)
);

alter table ai_provider_consents enable row level security;

create policy "ai_provider_consents owner access"
  on ai_provider_consents for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
