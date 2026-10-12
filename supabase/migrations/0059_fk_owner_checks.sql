-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
-- Safe to apply at any time: it only adds checks on future inserts/updates,
-- and every row the app writes already points at the writer's own records.
--
-- Cross-user foreign keys (security hardening, Phase 1, 2026-10-09).
--
-- A foreign key check runs with RLS bypassed. So a policy that only checks
-- the row's own user_id (`auth.uid() = user_id`) still lets a signed-in user,
-- calling PostgREST directly with their own token, write a row of their own
-- that POINTS AT another user's record. The 2026-09-21 ai_messages hole
-- (0048) and the commission-rule backstop (0056) were two cases of this;
-- these are the remaining eight:
--
--   trade_history.trade_id            trade_images.trade_id
--   ai_reviews.trade_id               trade_excursions.trade_id
--   strategy_rules.strategy_id        field_definitions.strategy_id
--   ai_conversations.key_id           monthly_cost_postings.cost_id / transaction_id
--
-- Exploiting any of them needs the other user's record UUID (random v4, never
-- shown across accounts), so none leaks data. Two could interfere with the
-- other user, because the foreign key is part of the primary key: a foreign
-- row in trade_excursions (pk trade_id) or monthly_cost_postings
-- (pk cost_id, month) would take the slot the real owner later needs, and
-- the owner cannot see or delete it.
--
-- One generic trigger function instead of eight copies of 0056: the
-- referenced table and column come from the trigger arguments. It runs only
-- when the foreign key column is written (`update of <col>`), and an
-- `on delete set null` cascade writes null, which passes straight through.
-- Error code 42501 makes PostgREST answer 403, the same as an RLS refusal.

create or replace function enforce_fk_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ref_table text := tg_argv[0];
  fk_col text := tg_argv[1];
  ref_id uuid;
  owned boolean;
begin
  ref_id := (to_jsonb(new) ->> fk_col)::uuid;
  if ref_id is null then
    return new;
  end if;
  execute format('select exists (select 1 from %I where id = $1 and user_id = $2)', ref_table)
    into owned
    using ref_id, new.user_id;
  if not owned then
    raise exception using
      errcode = '42501',
      message = format('%s.%s must point at one of your own %s', tg_table_name, fk_col, ref_table);
  end if;
  return new;
end;
$$;

-- Trigger functions cannot be called directly, but keep the grant surface
-- minimal anyway.
revoke all on function enforce_fk_owner() from public, anon, authenticated;

drop trigger if exists trade_history_trade_owner on trade_history;
create trigger trade_history_trade_owner
  before insert or update of trade_id on trade_history
  for each row execute function enforce_fk_owner('trades', 'trade_id');

drop trigger if exists trade_images_trade_owner on trade_images;
create trigger trade_images_trade_owner
  before insert or update of trade_id on trade_images
  for each row execute function enforce_fk_owner('trades', 'trade_id');

drop trigger if exists ai_reviews_trade_owner on ai_reviews;
create trigger ai_reviews_trade_owner
  before insert or update of trade_id on ai_reviews
  for each row execute function enforce_fk_owner('trades', 'trade_id');

drop trigger if exists trade_excursions_trade_owner on trade_excursions;
create trigger trade_excursions_trade_owner
  before insert or update of trade_id on trade_excursions
  for each row execute function enforce_fk_owner('trades', 'trade_id');

drop trigger if exists strategy_rules_strategy_owner on strategy_rules;
create trigger strategy_rules_strategy_owner
  before insert or update of strategy_id on strategy_rules
  for each row execute function enforce_fk_owner('strategies', 'strategy_id');

drop trigger if exists field_definitions_strategy_owner on field_definitions;
create trigger field_definitions_strategy_owner
  before insert or update of strategy_id on field_definitions
  for each row execute function enforce_fk_owner('strategies', 'strategy_id');

drop trigger if exists ai_conversations_key_owner on ai_conversations;
create trigger ai_conversations_key_owner
  before insert or update of key_id on ai_conversations
  for each row execute function enforce_fk_owner('user_api_keys', 'key_id');

drop trigger if exists monthly_cost_postings_cost_owner on monthly_cost_postings;
create trigger monthly_cost_postings_cost_owner
  before insert or update of cost_id on monthly_cost_postings
  for each row execute function enforce_fk_owner('monthly_costs', 'cost_id');

drop trigger if exists monthly_cost_postings_transaction_owner on monthly_cost_postings;
create trigger monthly_cost_postings_transaction_owner
  before insert or update of transaction_id on monthly_cost_postings
  for each row execute function enforce_fk_owner('account_transactions', 'transaction_id');

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0059_fk_owner_checks.sql')
on conflict do nothing;

-- Check after applying (expect 9 rows):
--   select distinct event_object_table, trigger_name from information_schema.triggers
--   where action_statement like '%enforce_fk_owner%' order by 1, 2;
