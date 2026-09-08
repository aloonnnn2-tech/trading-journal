-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically -- see
-- supabase/migrations/*.sql for the existing convention.
--
-- Trading plan rules: measurable, user-defined conditions attached to a
-- strategy, which trades are then scored against.
--
-- WHY THIS EXISTS. A trader could already write "risk 1%, target 2R, enter on
-- volume" into strategies.description (0017) -- free text nobody can measure,
-- and which the AI trade review has to *interpret* rather than check. This
-- turns that paragraph into rows a pure function can evaluate, so "did I
-- follow my plan?" becomes a fact computed from stored data rather than a
-- model's reading of prose.
--
-- RULES HANG OFF STRATEGIES, not off trades. A rule is part of a plan, and a
-- trade is already linked to its strategies through trade_strategies (0017),
-- so a trade inherits the rules of whichever strategies it was tagged with.
-- That also means editing a rule immediately changes what every past trade is
-- scored against, which is correct: the rule is the current definition of the
-- plan, and there is no version of "what my plan used to say" that the app
-- could honestly reconstruct.
--
-- NOTHING IS STORED PER TRADE. Evaluation results are computed on read, never
-- persisted. Storing them would create a second source of truth that goes
-- stale the moment a trade is edited -- and this app's rule is that every
-- displayed metric must be reproducible from stored data. Recomputing is
-- cheap: it is arithmetic over rows already fetched to render the page.

create table strategy_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Deleting a strategy takes its rules with it. A rule with no plan to
  -- belong to has nothing to be evaluated against.
  strategy_id uuid not null references strategies(id) on delete cascade,

  -- What the trader calls this rule, shown verbatim in the adherence list.
  -- Free text on purpose: "Risk <= 1%" and "Never size up after a loss" are
  -- both legitimate names, and the machine-readable part lives in the columns
  -- below rather than being parsed back out of this.
  label text not null,

  -- WHERE the value being tested comes from:
  --   core    -- a column on `trades` (risk_percent, r_multiple, ...)
  --   derived -- computed from other stored data (holding_days, stop_moved)
  --   custom  -- a field_definitions key, read from trades.custom_fields or
  --              trades.strategy_field_values
  -- Kept as three explicit sources rather than one namespaced string so a
  -- custom field whose key happens to collide with a column name can never be
  -- silently read from the wrong place.
  subject_source text not null check (subject_source in ('core', 'derived', 'custom')),
  subject_key text not null,

  -- The comparison. Deliberately a fixed vocabulary rather than a free-text
  -- expression: an expression language would need a parser, a sandbox, and a
  -- story for what a malformed expression does to a page full of trades --
  -- for rules that are, in practice, always "this number vs that number".
  operator text not null check (
    operator in (
      'lte', 'lt', 'gte', 'gt', 'eq', 'neq', 'between',
      'is_set', 'is_not_set',
      'is_true', 'is_false',
      'text_eq', 'text_neq', 'contains'
    )
  ),

  -- Operands. Which one is used depends on the operator; all are nullable
  -- because most operators use none or one of them. Validated in
  -- src/lib/plan-rules/schema.ts, which is where the operator-to-operand
  -- pairing is enforced -- a check constraint covering every combination
  -- would be long, hard to read, and would duplicate that logic in a second
  -- place that could disagree with it.
  number_value numeric,
  number_value_max numeric,
  text_value text,

  -- Switched off without deleting, so a trader can suspend a rule they are
  -- deliberately relaxing this month without losing its definition.
  enabled boolean not null default true,

  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every read is "the rules for this strategy, in order".
create index strategy_rules_strategy_idx on strategy_rules (strategy_id, sort_order);

create trigger strategy_rules_set_updated_at
  before update on strategy_rules
  for each row
  execute function set_updated_at();

alter table strategy_rules enable row level security;

create policy "strategy_rules owner access"
  on strategy_rules for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
