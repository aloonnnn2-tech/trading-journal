-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
-- Apply after 0080. Safe before or after the code: without these tables the
-- Overall rules panel says the feature isn't switched on yet, and nothing
-- else reads them.
-- Down:
--   drop table if exists public.trade_rule_checks;
--   drop table if exists public.overall_rules;
--
-- Overall rules (2026-10-29). Alon: "an AI that checks if you stuck to your
-- strategy guidelines in trades. The user sets clear rules for his overall
-- strategy, e.g. when price is below SMA 150 exit the trade. It checks each
-- trade, and each month in how many trades you stuck to it."
--
-- One list of rules every trade is checked against (the per-strategy
-- strategy_rules of 0033 are separate and unchanged). Four kinds:
--   field    -- a trade value against a number, exactly as strategy_rules
--               (risk % <= 1, R:R >= 2, stop moved...); checked live
--   ma_exit  -- exit once the daily close crosses the SMA/EMA of N days
--               (below for a long, above for a short), within grace_days
--   ma_entry -- enter only with price above the SMA/EMA of N days, or with
--               one average above another (mirrored for a short)
--   text     -- a rule in words; only the AI review judges it
-- The app decides field and moving-average rules from data; nothing about a
-- verdict is left to the AI except text rules, which are labelled as such.

create table if not exists public.overall_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  kind text not null check (kind in ('field', 'ma_exit', 'ma_entry', 'text')),

  -- field rules: the vocabulary of strategy_rules (0033).
  subject_source text check (subject_source in ('core', 'derived', 'custom')),
  subject_key text,
  operator text check (
    operator in (
      'lte', 'lt', 'gte', 'gt', 'eq', 'neq', 'between',
      'is_set', 'is_not_set', 'is_true', 'is_false',
      'text_eq', 'text_neq', 'contains'
    )
  ),
  number_value numeric,
  number_value_max numeric,
  text_value text,

  -- moving-average rules.
  ma_type text check (ma_type in ('sma', 'ema')),
  ma_period integer check (ma_period between 2 and 400),
  -- ma_entry 'ma_above_ma': the second, slower average.
  ma_type_2 text check (ma_type_2 in ('sma', 'ema')),
  ma_period_2 integer check (ma_period_2 between 2 and 400),
  entry_template text check (entry_template in ('price_above_ma', 'ma_above_ma')),
  grace_days integer not null default 1 check (grace_days between 0 and 10),

  -- Which trades it applies to.
  direction text not null default 'both' check (direction in ('both', 'long', 'short')),
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint overall_rules_size_limits check (
    char_length(label) <= 300
    and (subject_key is null or char_length(subject_key) <= 200)
    and (text_value is null or char_length(text_value) <= 400)
  ),
  -- Each kind carries what it needs (the app checks the details; this keeps
  -- a row from another path from being meaningless).
  constraint overall_rules_kind_shape check (
    (kind = 'field' and subject_source is not null and subject_key is not null and operator is not null)
    or (kind = 'ma_exit' and ma_type is not null and ma_period is not null)
    or (kind = 'ma_entry' and entry_template = 'price_above_ma' and ma_type is not null and ma_period is not null)
    or (kind = 'ma_entry' and entry_template = 'ma_above_ma' and ma_type is not null and ma_period is not null
        and ma_type_2 is not null and ma_period_2 is not null)
    or (kind = 'text')
  )
);

create index if not exists overall_rules_user_idx on public.overall_rules (user_id, sort_order);

drop trigger if exists overall_rules_set_updated_at on public.overall_rules;
create trigger overall_rules_set_updated_at
  before update on public.overall_rules
  for each row execute function set_updated_at();

alter table public.overall_rules enable row level security;
drop policy if exists "overall_rules owner access" on public.overall_rules;
create policy "overall_rules owner access"
  on public.overall_rules for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 50 rules: far beyond a real plan, and the AI prompts list them all.
drop trigger if exists overall_rules_user_row_cap on public.overall_rules;
create trigger overall_rules_user_row_cap
  after insert on public.overall_rules
  referencing new table as new_rows
  for each statement execute function public.enforce_user_row_cap('50');

-- ---------------------------------------------------------------------------
-- Moving-average results, one per trade and rule. Stored because each needs
-- a price-history fetch; field rules are evaluated live and never stored.
-- trade_updated_at / rule_updated_at say what the result was worked out
-- from: when either moved on, the app recomputes it.

create table if not exists public.trade_rule_checks (
  trade_id uuid not null references public.trades(id) on delete cascade,
  rule_id uuid not null references public.overall_rules(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  outcome text not null check (outcome in ('followed', 'broken', 'not_triggered', 'unevaluable')),
  detail jsonb not null default '{}'::jsonb,
  trade_updated_at timestamptz not null,
  rule_updated_at timestamptz not null,
  computed_at timestamptz not null default now(),
  primary key (trade_id, rule_id),
  constraint trade_rule_checks_detail_size check (
    jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 4096
  )
);

create index if not exists trade_rule_checks_user_idx on public.trade_rule_checks (user_id);
create index if not exists trade_rule_checks_rule_idx on public.trade_rule_checks (rule_id);

alter table public.trade_rule_checks enable row level security;
drop policy if exists "trade_rule_checks owner access" on public.trade_rule_checks;
create policy "trade_rule_checks owner access"
  on public.trade_rule_checks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- The trade and the rule must both be the row owner's own (0059's guard):
-- foreign keys skip RLS, so without these a direct API call could attach a
-- result to someone else's trade id and, since (trade_id, rule_id) is the
-- primary key, block a row the owner can't even see.
drop trigger if exists trade_rule_checks_trade_owner on public.trade_rule_checks;
create trigger trade_rule_checks_trade_owner
  before insert or update of trade_id on public.trade_rule_checks
  for each row execute function enforce_fk_owner('trades', 'trade_id');

drop trigger if exists trade_rule_checks_rule_owner on public.trade_rule_checks;
create trigger trade_rule_checks_rule_owner
  before insert or update of rule_id on public.trade_rule_checks
  for each row execute function enforce_fk_owner('overall_rules', 'rule_id');

-- 50 rules x 100,000 trades would never be reached; the cap bounds abuse.
drop trigger if exists trade_rule_checks_user_row_cap on public.trade_rule_checks;
create trigger trade_rule_checks_user_row_cap
  after insert on public.trade_rule_checks
  referencing new table as new_rows
  for each statement execute function public.enforce_user_row_cap('200000');

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0081_overall_rules.sql')
on conflict do nothing;
