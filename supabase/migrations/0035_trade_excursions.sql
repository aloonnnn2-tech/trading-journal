-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically -- see
-- supabase/migrations/*.sql for the existing convention.
--
-- MAE / MFE: how far each trade moved against, and in favour of, the position
-- while it was held.
--
-- WHY THIS IS STORED RATHER THAN COMPUTED ON READ. Every other derived figure
-- in this app is recomputed on demand, precisely so it can never go stale.
-- This one cannot be: the inputs are daily bars from an unofficial, rate-
-- limited third-party endpoint, fetched over the network from this app's own
-- IP. Recomputing a journal's worth of excursions on every page view would be
-- hundreds of outbound requests per render. So the result is written down
-- once, and recomputed only when the user asks.
--
-- A SEPARATE TABLE, NOT COLUMNS ON `trades`. Two reasons:
--   1. "Never computed" and "computed, and there is no data" are different
--      states that a nullable column on `trades` cannot tell apart -- and the
--      difference is exactly what the UI needs to say. A missing row means
--      never asked; a row with status <> 'ok' means asked and answered.
--   2. These are derived from an EXTERNAL source that can be absent, wrong or
--      revised. Keeping them out of `trades` keeps the trade row the user's
--      own record, and means dropping every excursion is one truncate rather
--      than a column migration.

create table trade_excursions (
  -- One row per trade, so recomputation replaces rather than accumulates.
  trade_id uuid primary key references trades(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- The symbol actually queried, which is a GUESS (see guessYahooSymbol:
  -- crypto gets -USD, forex gets =X). Recorded so a wrong result can be
  -- traced to a wrong symbol rather than looking like bad price data.
  symbol text not null,

  -- Why this row exists in whatever state it is in. 'ok' is the only status
  -- carrying figures; the rest explain an empty result so the UI never has to
  -- say "no data" without a reason.
  --   same_day     -- one daily bar cannot separate the hold from the session
  --   no_data      -- outside the history window, delisted, or wrong symbol
  --   no_prices    -- entry or exit price missing on the trade
  --   no_direction -- without long/short there is no "in your favour"
  --   coarse_data  -- the provider returned bars coarser than daily, whose
  --                   highs and lows span far more than the holding period
  status text not null check (
    status in ('ok', 'same_day', 'no_data', 'no_prices', 'no_direction', 'coarse_data')
  ),

  -- Worst and best prices reached while held, and the same as signed moves in
  -- the position's favour: MAE is normally negative, MFE positive. MAE can be
  -- positive when a trade never traded against the entry, which is a real
  -- outcome and is stored as such rather than clamped to zero.
  mae_price numeric,
  mfe_price numeric,
  mae_percent numeric,
  mfe_percent numeric,

  -- The same excursions in R. Null when the trade recorded no stop -- R
  -- without the risk it is a multiple of would be a fabricated denominator.
  mae_r numeric,
  mfe_r numeric,

  -- How many daily bars the answer rests on, and whether the entry/exit day
  -- bars were included. When true the figures are an OUTER BOUND: the entry
  -- day's low may predate the entry. Stored rather than assumed so every
  -- surface can state it.
  candles_used integer not null default 0,
  includes_partial_days boolean not null default false,

  computed_at timestamptz not null default now()
);

-- The dominant read is "every excursion for this user", to build aggregates.
create index trade_excursions_user_idx on trade_excursions (user_id);

alter table trade_excursions enable row level security;

create policy "trade_excursions owner access"
  on trade_excursions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
