-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically -- see
-- supabase/migrations/*.sql for the existing convention.
--
-- Generated AI reviews: the paid "AI Trade Review" feature, and the period
-- (weekly / monthly / custom) reviews built on the same foundation.
--
-- ONE TABLE FOR BOTH, because they are the same record with a different
-- scope: some model, on the user's own key, produced a structured critique of
-- some set of trades at some point in time. Two tables would duplicate the
-- provider/model/staleness columns and then need two readers, two delete
-- routes and two retention rules for no gain.
--
-- Reviews are STORED rather than recomputed on every view. The generation
-- spends the user's own provider quota, so re-deriving one to render a page
-- the user already paid to produce would be the app quietly spending their
-- money. It also means a review stays readable when the key that produced it
-- is later revoked.

create table ai_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  review_type text not null check (review_type in ('trade', 'weekly', 'monthly', 'custom')),

  -- Set for a single-trade review, null for a period one. `on delete cascade`
  -- because a review of a deleted trade is unreadable: every figure in it
  -- refers to a row that no longer exists.
  trade_id uuid references trades(id) on delete cascade,

  -- Local calendar days (resolved in the user's timezone before insert), not
  -- timestamps. The period a review covers is a human-facing range -- "week of
  -- 25 Aug" -- and storing instants would re-open the UTC-vs-local bug that
  -- 0020-era analytics fixes and src/lib/dates/local-day.ts exist to prevent.
  period_start date,
  period_end date,

  -- Scope and type must agree. Without this a row can claim to be a trade
  -- review while carrying a date range, or a weekly review with no range at
  -- all -- shapes no reader knows how to render, and which only ever appear
  -- long after the bug that wrote them.
  constraint ai_reviews_scope_matches_type check (
    (review_type = 'trade'
      and trade_id is not null
      and period_start is null
      and period_end is null)
    or
    (review_type <> 'trade'
      and trade_id is null
      and period_start is not null
      and period_end is not null
      and period_end >= period_start)
  ),

  -- How many positions the review actually covered. Shown to the user
  -- ("24 trades analysed") and used to detect that the period has since
  -- gained or lost trades.
  trades_analyzed integer not null check (trades_analyzed >= 0),

  -- Which provider and model produced this. Recorded because the answer is
  -- only interpretable alongside the thing that wrote it: a review from a
  -- 8B free-tier model and one from a frontier model are not the same
  -- artifact, and the user swaps between them freely. Same six values as
  -- user_api_keys.provider (0030); NOT a foreign key to user_api_keys, so a
  -- review survives the user deleting the key that generated it.
  provider text not null check (provider in ('openai', 'anthropic', 'google', 'groq', 'openrouter', 'cerebras')),
  model text not null,

  -- The validated structured review (see src/lib/ai-reviews/schema.ts).
  -- jsonb rather than text: the app renders it section by section into fixed
  -- components, so it is read as structure, never as prose.
  --
  -- Written only by the server, after zod validation. RLS below still lets a
  -- user insert into their OWN row -- as it does for trades and every other
  -- table here -- which means a determined user could fabricate a review of
  -- their own journal. That is deliberately not defended against: it is their
  -- own data, visible only to them, and the alternative (revoking insert and
  -- routing through the service-role key) would trade a real security
  -- boundary for a cosmetic one.
  content jsonb not null,

  -- STALENESS (§13): the newest `updated_at` across the trades this review
  -- analysed. A trade edited after generation moves its own updated_at past
  -- this value, which is what lets the UI say "generated before 3 trades were
  -- edited" instead of silently showing a critique of numbers that changed.
  --
  -- Derived from data the app already maintains -- `trades` has had an
  -- updated_at trigger since 0001 -- so this costs no new column on trades
  -- and no write path anywhere else.
  source_updated_at timestamptz,

  created_at timestamptz not null default now()
);

-- One review per trade: regenerating REPLACES rather than accumulating.
--
-- Trade reviews deliberately keep no history: a superseded critique of a
-- trade that has since been corrected is not a record anyone wants, and one
-- row per trade bounds the table by the size of the journal. Period reviews
-- DO keep history -- comparing this week's review with last week's is the
-- point of having them, and they are unaffected here because Postgres treats
-- nulls as distinct in a unique constraint: every period review carries a
-- null trade_id and so never conflicts with another.
--
-- Deliberately a CONSTRAINT rather than a partial unique index, even though a
-- partial index (`where trade_id is not null`) would be marginally smaller.
-- `insert ... on conflict (user_id, trade_id)` -- which is how regeneration
-- replaces a review in one statement -- can only infer a partial index if the
-- statement repeats the index's WHERE predicate, and PostgREST's upsert emits
-- only the column list. Against a partial index the upsert would therefore
-- fail at runtime with "no unique or exclusion constraint matching the ON
-- CONFLICT specification", every time, on a path that looks correct here.
alter table ai_reviews
  add constraint ai_reviews_one_per_trade unique (user_id, trade_id);

-- Covers the period-history list (newest first, filtered by type) and, via
-- its leading column, any "all my reviews" read.
create index ai_reviews_user_period_idx
  on ai_reviews (user_id, review_type, period_start desc);

alter table ai_reviews enable row level security;

create policy "ai_reviews owner access"
  on ai_reviews for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
