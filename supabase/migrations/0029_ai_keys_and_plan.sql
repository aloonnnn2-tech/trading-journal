-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically -- see
-- supabase/migrations/*.sql for the existing convention.
--
-- Paid "Ask Your Journal" (bring-your-own-key AI). Two independent pieces:
--   1. a minimal free/paid plan flag, which nothing in the app has had until
--      now (no Stripe, no subscriptions table -- see below);
--   2. per-user AI provider API keys, stored encrypted at rest.

-- 1. PLAN FLAG ---------------------------------------------------------------
--
-- Deliberately a plain column on user_settings rather than a subscriptions
-- table: there is no billing system yet, nothing writes this automatically,
-- and a single row per user with one of two values doesn't need its own
-- entity. If real billing ever lands (renewal dates, payment state, plan
-- history), that's the point to promote this to its own table -- not now.
alter table user_settings
  add column plan text not null default 'free' check (plan in ('free', 'paid'));

-- NO GRANT FOR `plan` -- THIS OMISSION IS THE SECURITY CONTROL.
--
-- 0024_user_settings_column_grants.sql fixed a privilege escalation on this
-- exact table: `is_admin` sat on user_settings, whose only policy is
-- "user_settings owner access" (0003) -- `for all using (auth.uid() =
-- user_id)`. RLS constrains which *rows* a user may write and has no way to
-- express which *columns*, so the policy happily allowed a user to set their
-- own row's is_admin to true. The anon key is public by design (shipped to
-- the browser in src/lib/supabase/client.ts), making it a one-liner from
-- devtools.
--
-- `plan` is the same shape of column and would be the same bug:
--
--   supabase.from("user_settings").update({ plan: 'paid' }).eq("user_id", myId)
--
-- 0024 already revoked the table-level insert/update from `authenticated` and
-- re-granted a specific column list, and column-level grants cover only the
-- columns they name -- so a newly added column starts with no write privilege
-- and this is safe *by default*. That default is load-bearing, not incidental:
-- do not add `plan` to those grant lists, and do not restore a table-wide
-- `grant update on user_settings`. From here, plan is settable only with the
-- service-role key -- i.e. from the Supabase dashboard, or the admin-gated
-- route that uses createAdminClient() (src/lib/supabase/admin.ts).
--
-- `select` is intentionally untouched, matching 0024's treatment of is_admin:
-- the app must read plan on every page that gates on it (getUserSettings in
-- src/lib/settings/queries.ts). Reading it was never the problem.

-- 2. USER API KEYS -----------------------------------------------------------
--
-- One row per provider key the user has added. Multiple rows per user is the
-- intended shape, not an accident -- a user may hold an OpenAI and an
-- Anthropic key at once and pick between them per question, so there is
-- deliberately no unique constraint on (user_id, provider).
create table user_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  provider text not null check (provider in ('openai', 'anthropic', 'google')),

  -- Optional user-supplied nickname, e.g. "personal" vs "work billing acct",
  -- so the key picker is meaningful when several keys share a provider.
  label text,

  -- AES-256-GCM ciphertext produced by src/lib/ai-keys/crypto.ts, keyed by the
  -- server-only AI_KEY_ENCRYPTION_SECRET env var. The plaintext key never
  -- touches this column and is never returned to the client after creation --
  -- it is decrypted server-side only, inside the route about to call the
  -- provider. A database dump alone therefore does not leak usable keys.
  encrypted_key text not null,

  -- Last 4 characters of the *plaintext* key, kept separately so the UI can
  -- render "•••• 4a2f" without decrypting anything. 4 characters of a 40+
  -- character secret is not enough to narrow a brute force meaningfully, and
  -- it is what lets a user tell two keys apart when both are masked.
  last_four text not null,

  -- Soft-disable without deleting, so a user can park a key (e.g. while its
  -- billing is sorted out) instead of re-pasting it later. The ask route only
  -- ever selects active keys.
  is_active boolean not null default true,

  -- When the key last passed a live provider check. Set on create (keys are
  -- test-called before they are ever saved) so a saved key is known-good at
  -- least once -- a silently-saved bad key produces a confusing failure at
  -- question time instead of an actionable one at setup time.
  last_validated_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Both read paths filter by user_id and all but the management list also
-- filter is_active, so the composite covers each without a second index.
create index user_api_keys_user_active_idx on user_api_keys (user_id, is_active);

create trigger user_api_keys_set_updated_at
  before update on user_api_keys
  for each row
  execute function set_updated_at();

alter table user_api_keys enable row level security;

create policy "user_api_keys owner access"
  on user_api_keys for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
