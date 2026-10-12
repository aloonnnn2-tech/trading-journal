-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
--
-- Lock down users' AI provider keys (security pass, 2026-09-30).
--
-- Until now `user_api_keys` kept Supabase's default table-wide grants for
-- the `authenticated` role, bounded only by the owner RLS policy (0029). RLS
-- limits WHICH ROWS a user touches, not WHICH COLUMNS -- so a stolen session
-- or an XSS, acting with the user's own JWT straight against PostgREST, could:
--   * read the ciphertext of every key the user has,
--   * change a key's `provider`, sending the key to a different provider's
--     servers the next time it is used,
--   * insert keys, skipping the 10-key cap and the provider check.
-- (user_settings got column-level grants for exactly this reason in 0024.)
--
-- After this, the `authenticated` role can only see a key's PUBLIC columns
-- and change its label / on-off state or delete it. Storing a key, reading
-- its ciphertext and recording its model happen server-side only, through
-- src/lib/ai-keys/vault.ts with the service-role key, filtered by the user
-- id of the verified session.
--
-- ORDER MATTERS: apply this only AFTER the code with vault.ts is deployed.
-- Older code inserts and decrypts keys through the user's own session, which
-- this migration forbids -- applied first, the live site could no longer
-- save or use keys. (The new code works with or without it.)

-- When the key was last sent to its provider: shown to the user, so use they
-- didn't make stands out.
alter table user_api_keys add column if not exists last_used_at timestamptz;

-- The model id ends up in a provider URL (Google). Only the characters the
-- API accepts; 0053's check only bounded the length.
alter table user_api_keys drop constraint if exists user_api_keys_model_chars;
alter table user_api_keys
  add constraint user_api_keys_model_chars
    check (model is null or model ~ '^[A-Za-z0-9_.:/@-]{1,200}$');

-- Column-level privileges. REVOKE first: a column grant does not remove a
-- table-wide one, and the table-wide one is what has to go.
revoke all on user_api_keys from anon;
revoke all on user_api_keys from authenticated;

grant select (
  id, user_id, provider, label, last_four, is_active, model,
  created_at, updated_at, last_validated_at, last_used_at
) on user_api_keys to authenticated;
grant update (label, is_active) on user_api_keys to authenticated;
grant delete on user_api_keys to authenticated;
-- No INSERT, and no SELECT/UPDATE on encrypted_key, provider, model or
-- user_id: those go through the service role only.

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0058_lock_down_api_keys.sql')
on conflict do nothing;
