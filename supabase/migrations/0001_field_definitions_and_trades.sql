-- Milestone 0: field-definition engine + core trades schema
-- Schema evolution is additive-only: editing/removing a field_definition row
-- never mutates existing trades.custom_fields data.

create extension if not exists "pgcrypto";

create type entity_type as enum ('trade', 'investment');

create type field_type as enum (
  'text',
  'number',
  'date',
  'currency',
  'percentage',
  'dropdown',
  'multi_select',
  'checkbox',
  'rating',
  'large_notes',
  'tag',
  'color_picker'
);

create type trade_status as enum ('pending', 'open', 'closed');
create type trade_result as enum ('open', 'win', 'loss', 'break_even');
create type trade_direction as enum ('long', 'short');

-- Per-user, per-entity-type field schema. Default fields (notes sections,
-- emotion fields, etc.) are seeded as rows here per new user, not
-- hardcoded in the UI, so the template editor (Milestone 2) can treat
-- every field -- default or custom -- the same way.
create table field_definitions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type entity_type not null,
  key text not null,
  label text not null,
  field_type field_type not null,
  options jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, entity_type, key)
);

create index field_definitions_user_entity_idx
  on field_definitions (user_id, entity_type, sort_order);

-- Core trade table. Fixed columns cover everything needed for fast
-- filtering, sorting, and analytics (Milestones 4-5); custom_fields jsonb
-- holds every user-defined field's value, keyed by field_definitions.key.
create table trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode entity_type not null default 'trade',

  ticker text not null,
  company_name text,
  asset_type text,
  market text,
  direction trade_direction,

  status trade_status not null default 'pending',
  result trade_result not null default 'open',

  entry_price numeric,
  exit_price numeric,
  stop_loss numeric,
  take_profit numeric,
  shares numeric,
  position_size numeric,
  dollar_amount numeric,
  risk_amount numeric,
  risk_percent numeric,

  entry_date timestamptz,
  exit_date timestamptz,

  dollar_pl numeric,
  percent_return numeric,
  r_multiple numeric,
  risk_reward_ratio numeric,

  custom_fields jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index trades_user_status_idx on trades (user_id, status);
create index trades_user_entry_date_idx on trades (user_id, entry_date);
create index trades_custom_fields_gin_idx on trades using gin (custom_fields);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trades_set_updated_at
  before update on trades
  for each row
  execute function set_updated_at();

alter table field_definitions enable row level security;
alter table trades enable row level security;

create policy "field_definitions owner access"
  on field_definitions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "trades owner access"
  on trades for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
