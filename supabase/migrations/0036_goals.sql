-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically -- see
-- supabase/migrations/*.sql for the existing convention.
--
-- Trading goals: a commitment the trader makes, measured against what they
-- actually did.
--
-- **EVERY GOAL MUST RESOLVE TO A COUNTABLE CONDITION.** The brief is explicit
-- that subjective goals must not be turned into fake numerical scores, so
-- there is deliberately no free-text "goal" with a hand-moved slider. A goal
-- is one of three measurable shapes:
--
--   adherence -- a per-trade condition, met on at least/at most N% of trades.
--                The condition is EXACTLY a plan rule (0033): same subjects,
--                same operators, same evaluator. "Risk <= 1% on 90% of trades"
--                is a plan rule with a target attached.
--   aggregate -- a period metric against a number: trade count, win rate,
--                expectancy, average loss in R, total R.
--   reduction -- how many trades carried a given mistake, from the mistake
--                tracker (0034 + the detectors). "No stop movement" is this,
--                with a target of zero.
--
-- Anything a trader cannot express in one of those shapes is something this
-- app cannot honestly measure, and the editor says so rather than offering a
-- progress bar driven by nothing.
--
-- NOTHING IS STORED PER PERIOD. Progress is recomputed from the trades on
-- every read, so a goal can never disagree with the journal behind it, and
-- correcting a trade immediately corrects every goal that counted it.

create table goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- The trader's own words for it, shown verbatim.
  label text not null,

  kind text not null check (kind in ('adherence', 'aggregate', 'reduction')),

  -- ---- adherence: the per-trade condition -------------------------------
  -- Same vocabulary as strategy_rules (0033). Repeated here rather than
  -- referenced because a goal is not attached to a strategy: it applies to
  -- every trade in the period, whatever it was tagged with.
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

  -- ---- aggregate: which measure ------------------------------------------
  -- Each maps to a figure the shared segments engine already computes, so a
  -- goal can never quote a number the Analytics page disagrees with.
  metric text check (
    metric in ('trade_count', 'win_rate', 'expectancy', 'avg_loss_r', 'total_r')
  ),

  -- ---- reduction: which mistake ------------------------------------------
  -- Matches a label the mistake tracker produces, whether detected
  -- automatically or tagged by hand.
  mistake_label text,

  -- ---- the target ---------------------------------------------------------
  -- Units depend on kind: a percentage of trades for adherence, the metric's
  -- own unit for aggregate, a count for reduction.
  target numeric not null,
  -- Which way is success. "At most 3 moved stops" and "at least 20 trades"
  -- are both goals; without this the same number means opposite things.
  target_direction text not null check (target_direction in ('at_least', 'at_most')),

  -- The window progress is measured over, resolved in the trader's own
  -- timezone at read time (see src/lib/goals/evaluate.ts).
  period text not null check (period in ('month', 'quarter', 'year', 'all_time')),

  -- Switched off without deleting, so a goal met and paused keeps its record.
  active boolean not null default true,
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The shape must match the kind, or nothing can evaluate it. Without this a
  -- row can claim to be an adherence goal with no condition, which would sit
  -- on the page forever showing no progress and no reason why.
  constraint goals_shape_matches_kind check (
    (kind = 'adherence' and subject_source is not null and subject_key is not null and operator is not null)
    or (kind = 'aggregate' and metric is not null)
    or (kind = 'reduction' and mistake_label is not null)
  )
);

create index goals_user_idx on goals (user_id, sort_order);

create trigger goals_set_updated_at
  before update on goals
  for each row
  execute function set_updated_at();

alter table goals enable row level security;

create policy "goals owner access"
  on goals for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
