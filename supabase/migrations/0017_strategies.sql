-- Strategies as first-class, manageable entities (replacing the old
-- free-text "Strategy / Setup" tag, which just lived as retyped strings
-- in custom_fields.strategy_setup with no canonical list and no way to
-- rename a strategy retroactively across past trades).
--
-- A trade can use more than one strategy at once (kept from the old tag
-- behavior), hence the join table rather than a single strategy_id
-- column on trades.

create table strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  color text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create trigger strategies_set_updated_at
  before update on strategies
  for each row
  execute function set_updated_at();

create table trade_strategies (
  trade_id uuid not null references trades(id) on delete cascade,
  strategy_id uuid not null references strategies(id) on delete cascade,
  primary key (trade_id, strategy_id)
);

create index trade_strategies_strategy_idx on trade_strategies (strategy_id);

alter table strategies enable row level security;
alter table trade_strategies enable row level security;

create policy "strategies owner access"
  on strategies for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "trade_strategies owner access"
  on trade_strategies for all
  using (exists (select 1 from strategies s where s.id = strategy_id and s.user_id = auth.uid()))
  with check (exists (select 1 from strategies s where s.id = strategy_id and s.user_id = auth.uid()));

-- Custom fields scoped to one strategy (e.g. "Volume confirmation" only
-- makes sense for a "Breakout" strategy). null strategy_id keeps today's
-- behavior -- a field global to the entity type. The original
-- (user_id, entity_type, key) unique constraint is replaced with two
-- partial indexes because a plain unique index would let every
-- strategy_id-null row collide on nothing -- Postgres treats each NULL as
-- distinct, which is correct for the *strategy-scoped* half (two
-- different strategies re-using the same key must be allowed) but wrong
-- for the *global* half (those still need one key to mean one field).
alter table field_definitions
  add column strategy_id uuid references strategies(id) on delete cascade;

alter table field_definitions
  drop constraint field_definitions_user_id_entity_type_key_key;

create unique index field_definitions_global_key_idx
  on field_definitions (user_id, entity_type, key)
  where strategy_id is null;

create unique index field_definitions_strategy_key_idx
  on field_definitions (user_id, entity_type, strategy_id, key)
  where strategy_id is not null;

-- Values for strategy-scoped custom fields, namespaced by strategy_id:
-- { "<strategy_id>": { "<field_key>": value, ... }, ... }. A separate
-- column (rather than folding into custom_fields) because a trade
-- carrying multiple strategies could otherwise collide if two of them
-- define a field with the same key.
alter table trades
  add column strategy_field_values jsonb not null default '{}'::jsonb;

alter table user_settings
  add column has_completed_tour boolean not null default false;

-- One-time backfill: turn each user's existing free-text strategy_setup
-- tag values into real strategy rows + trade_strategies links. Left
-- as plain SQL (not a function) since it only ever needs to run once,
-- driven by data that already exists at migration time.
with tag_values as (
  select
    t.user_id,
    t.id as trade_id,
    tag as name
  from trades t
  cross join lateral jsonb_array_elements_text(
    -- Guard the array shape *before* calling the set-returning function --
    -- a WHERE clause on jsonb_typeof would filter rows too late, since
    -- jsonb_array_elements_text errors immediately on non-array input
    -- (missing key, string, object, etc.) rather than being skipped by it.
    case
      when jsonb_typeof(t.custom_fields->'strategy_setup') = 'array'
      then t.custom_fields->'strategy_setup'
      else '[]'::jsonb
    end
  ) as tag
  where trim(tag) <> ''
),
inserted_strategies as (
  insert into strategies (user_id, name)
  select distinct user_id, trim(name)
  from tag_values
  on conflict (user_id, name) do nothing
  returning id, user_id, name
),
all_strategies as (
  select id, user_id, name from inserted_strategies
  union
  select s.id, s.user_id, s.name
  from strategies s
  join (select distinct user_id, trim(name) as name from tag_values) tv
    on tv.user_id = s.user_id and tv.name = s.name
)
insert into trade_strategies (trade_id, strategy_id)
select distinct tv.trade_id, s.id
from tag_values tv
join all_strategies s on s.user_id = tv.user_id and s.name = trim(tv.name)
on conflict do nothing;
