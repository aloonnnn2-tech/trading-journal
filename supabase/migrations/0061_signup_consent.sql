-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
-- Safe to apply before or after the code: until the new sign-up form sends
-- the flags, new accounts simply get nulls, exactly like existing ones.
--
-- Records that a new account confirmed being 18+ and accepted the Terms and
-- Privacy Policy (security hardening, Part B, 2026-10-09).
--
-- The sign-up form now has a required checkbox. Ticking it sends two flags in
-- the sign-up metadata. This trigger copies them into user_settings with the
-- DATABASE's own clock, so the record says when the account was created
-- with that agreement and cannot be back-dated from the browser.
--
-- The columns get NO write grant for `authenticated` (user_settings is
-- granted column by column since 0024), so a user cannot change or clear
-- their own record afterwards. Only this trigger and the service role write
-- them.
--
-- Existing accounts stay null: they signed up before the checkbox existed
-- ("pre-consent"), under the passive "By creating an account you agree"
-- wording. Accounts made by the service role (seed scripts, e2e, the demo
-- account) send no flags and also stay null.

alter table user_settings
  add column if not exists age_confirmed_at timestamptz,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text check (terms_version is null or length(terms_version) <= 40);

create or replace function seed_user_settings()
returns trigger as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  version text := left(meta->>'accepted_terms_version', 40);
begin
  insert into public.user_settings (user_id, age_confirmed_at, terms_accepted_at, terms_version)
  values (
    new.id,
    case when meta->>'age_confirmed' = 'true' then now() end,
    case when version is not null and version <> '' then now() end,
    nullif(version, '')
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- The trigger itself (0003, on_auth_user_created_seed_settings) is unchanged;
-- `create or replace function` is picked up by it.

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0061_signup_consent.sql')
on conflict do nothing;

-- Check after applying (new sign-ups only):
--   select user_id, age_confirmed_at, terms_accepted_at, terms_version
--   from user_settings order by created_at desc limit 5;
