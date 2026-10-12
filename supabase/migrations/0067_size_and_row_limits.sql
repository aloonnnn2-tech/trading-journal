-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
-- Apply after 0066. Safe before or after the code: it changes no columns,
-- and every limit is far above anything the app writes or live holds.
--
-- Full check, 2026-10-12, finding N-2: no size or row limits in the
-- database.
--
-- The app checks lengths in its API routes (zod) and the proxy refuses
-- request bodies over 1 MB. None of that applies to a signed-in user
-- writing straight to Supabase with the anon key every browser holds: a
-- single row could carry megabytes, and one account could insert rows
-- without end -- database bloat and cost, though never anyone else's data.
--
-- Two kinds of limit, both set well above real use:
--
-- 1. Size checks per column, at or above the app's own limit (so nothing the
--    app accepts is ever refused here). Live maxima on 2026-10-12, for
--    scale: custom_fields 830 chars, a strategy description 128, an AI
--    message 5,395, a history snapshot 1,653.
--      custom_fields 1 MB: the app does not limit a single note field, only
--      the proxy's 1 MB body does, so this matches what the app can send.
--      trade_history.snapshot 2 MB: the snapshot trigger copies a whole
--      trade row into it, so it must exceed the largest trade row.
--
-- 2. Rows per account, checked once per INSERT statement (so a 500-row
--    import batch costs one count, not 500). Largest live account on
--    2026-10-12: 334 trades. Refused with SQLSTATE 54000.
--
-- Not covered here: the analytics tables (0066 removed user writes),
-- trade_history (0023 already keeps 50 snapshots per trade), the junction
-- tables (a primary key pair per trade, nothing to bloat) and Storage
-- (0060: 10 MB per file, image types only).

-- ---------------------------------------------------------------------------
-- 1. Size checks. Dropped first so pasting this file twice is harmless.
-- ---------------------------------------------------------------------------

alter table public.trades
  drop constraint if exists trades_size_limits,
  add constraint trades_size_limits check (
    char_length(ticker) <= 64
    and (company_name is null or char_length(company_name) <= 400)
    and (market is null or char_length(market) <= 128)
    and (asset_type is null or char_length(asset_type) <= 128)
    and (custom_fields is null or octet_length(custom_fields::text) <= 1048576)
    and (strategy_field_values is null or octet_length(strategy_field_values::text) <= 262144)
    and (dismissed_suggestions is null or cardinality(dismissed_suggestions) <= 200)
  );

alter table public.trade_history
  drop constraint if exists trade_history_size_limits,
  add constraint trade_history_size_limits check (
    snapshot is null or octet_length(snapshot::text) <= 2097152
  );

alter table public.trade_images
  drop constraint if exists trade_images_size_limits,
  add constraint trade_images_size_limits check (char_length(storage_path) <= 512);

alter table public.trade_excursions
  drop constraint if exists trade_excursions_size_limits,
  add constraint trade_excursions_size_limits check (symbol is null or char_length(symbol) <= 64);

alter table public.account_transactions
  drop constraint if exists account_transactions_size_limits,
  add constraint account_transactions_size_limits check (note is null or char_length(note) <= 1000);

alter table public.strategies
  drop constraint if exists strategies_size_limits,
  add constraint strategies_size_limits check (
    char_length(name) <= 200
    and (description is null or char_length(description) <= 2000)
    and (color is null or char_length(color) <= 64)
  );

alter table public.strategy_rules
  drop constraint if exists strategy_rules_size_limits,
  add constraint strategy_rules_size_limits check (
    char_length(label) <= 200
    and (subject_key is null or char_length(subject_key) <= 200)
    and (text_value is null or char_length(text_value) <= 400)
  );

alter table public.field_definitions
  drop constraint if exists field_definitions_size_limits,
  add constraint field_definitions_size_limits check (
    char_length(key) <= 200
    and char_length(label) <= 200
    and (options is null or octet_length(options::text) <= 65536)
  );

alter table public.folders
  drop constraint if exists folders_size_limits,
  add constraint folders_size_limits check (char_length(name) <= 200);

alter table public.goals
  drop constraint if exists goals_size_limits,
  add constraint goals_size_limits check (
    char_length(label) <= 200
    and (text_value is null or char_length(text_value) <= 400)
  );

alter table public.commission_rules
  drop constraint if exists commission_rules_size_limits,
  add constraint commission_rules_size_limits check (
    char_length(name) <= 200
    and (market is null or char_length(market) <= 128)
    and (asset_type is null or char_length(asset_type) <= 128)
  );

alter table public.ai_conversations
  drop constraint if exists ai_conversations_size_limits,
  add constraint ai_conversations_size_limits check (
    (title is null or char_length(title) <= 500)
    and (provider is null or char_length(provider) <= 64)
    and (model is null or char_length(model) <= 200)
  );

alter table public.ai_messages
  drop constraint if exists ai_messages_size_limits,
  add constraint ai_messages_size_limits check (
    (content is null or char_length(content) <= 2000000)
    and (parts is null or octet_length(parts::text) <= 2097152)
    and (tool_calls is null or octet_length(tool_calls::text) <= 1048576)
    and (tool_name is null or char_length(tool_name) <= 200)
    and (tool_call_id is null or char_length(tool_call_id) <= 200)
  );

alter table public.ai_reviews
  drop constraint if exists ai_reviews_size_limits,
  add constraint ai_reviews_size_limits check (
    (content is null or octet_length(content::text) <= 1048576)
    and (model is null or char_length(model) <= 200)
  );

alter table public.ai_provider_consents
  drop constraint if exists ai_provider_consents_size_limits,
  add constraint ai_provider_consents_size_limits check (scope is null or char_length(scope) <= 64);

alter table public.user_api_keys
  drop constraint if exists user_api_keys_size_limits,
  add constraint user_api_keys_size_limits check (label is null or char_length(label) <= 200);

alter table public.user_settings
  drop constraint if exists user_settings_size_limits,
  add constraint user_settings_size_limits check (
    (dashboard_layout is null or octet_length(dashboard_layout::text) <= 65536)
    and (hidden_core_fields is null or cardinality(hidden_core_fields) <= 200)
    and (timezone is null or char_length(timezone) <= 64)
  );

-- ---------------------------------------------------------------------------
-- 2. Rows per account, once per INSERT statement.
-- ---------------------------------------------------------------------------

-- Runs as the inserting role (not security definer): under RLS a user's
-- count covers exactly their own rows, which is the number being limited;
-- the service role sees and counts the same rows.
create or replace function public.enforce_user_row_cap()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  cap integer := tg_argv[0]::integer;
  over_user uuid;
begin
  execute format(
    'select t.user_id from %I.%I t
      where t.user_id in (select distinct n.user_id from new_rows n)
      group by t.user_id
     having count(*) > $1
      limit 1',
    tg_table_schema, tg_table_name)
  into over_user
  using cap;
  if over_user is not null then
    raise exception 'Row limit reached: % allows at most % rows per account.', tg_table_name, cap
      using errcode = '54000';
  end if;
  return null;
end;
$$;

do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('trades', 100000),
      ('account_transactions', 20000),
      ('strategies', 1000),
      ('strategy_rules', 10000),
      ('field_definitions', 2000),
      ('folders', 1000),
      ('goals', 500),
      ('commission_rules', 500),
      ('monthly_costs', 200),
      ('trade_images', 20000),
      ('ai_conversations', 10000),
      ('ai_messages', 200000),
      ('ai_reviews', 5000)
    ) as v(tbl, cap)
  loop
    execute format('drop trigger if exists %I on public.%I', t.tbl || '_user_row_cap', t.tbl);
    execute format(
      'create trigger %I after insert on public.%I referencing new table as new_rows
         for each statement execute function public.enforce_user_row_cap(%L)',
      t.tbl || '_user_row_cap', t.tbl, t.cap::text);
  end loop;
end;
$$;

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0067_size_and_row_limits.sql')
on conflict do nothing;
