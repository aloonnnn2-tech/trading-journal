-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role key in this project, so
-- migrations are never applied automatically -- see supabase/migrations/*.sql
-- for the existing convention.
--
-- Broker commissions. Real brokers charge a fee on entry AND on exit, which
-- means a trade's true break-even price sits *past* its entry price: buy 1
-- share at $90 with a $2.50-per-side fee and the price has to reach $95
-- before the position is actually profitable. Until now this app computed
-- P&L purely from price movement, overstating every result.
--
-- Rules live in their own table (rather than a jsonb blob on user_settings)
-- because they're a repeating, individually-editable, orderable, per-user
-- entity that's matched against each trade -- the same shape as `strategies`
-- in 0017, and for the same reasons.

create type commission_rule_type as enum ('flat', 'percent', 'per_unit');
create type commission_side as enum ('both', 'entry', 'exit');

create table commission_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,

  -- flat     -> `amount` is dollars charged per side, regardless of size
  -- percent  -> `amount` is a percent (2.5 = 2.5%) of that side's notional
  --             (price * shares)
  -- per_unit -> `amount` is dollars per share/contract
  rule_type commission_rule_type not null,
  amount numeric not null default 0,

  -- Which side(s) of the round trip this rule bills. 'both' is the common
  -- case (most brokers charge to open *and* to close); 'exit' covers the
  -- venues that only bill on the closing fill.
  applies_to commission_side not null default 'both',

  -- Optional scoping: null means "any". Matched case-insensitively against
  -- trades.asset_type / trades.market so one account can charge a flat fee
  -- on stocks and a percentage on crypto.
  asset_type text,
  market text,

  -- Optional per-side floor/cap, e.g. "0.1% but never less than $1.00".
  min_fee numeric,
  max_fee numeric,

  enabled boolean not null default true,
  -- First enabled rule that matches a trade wins, ordered by sort_order --
  -- so a specific "crypto" rule can be placed above a catch-all.
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index commission_rules_user_order_idx on commission_rules (user_id, sort_order);

create trigger commission_rules_set_updated_at
  before update on commission_rules
  for each row
  execute function set_updated_at();

alter table commission_rules enable row level security;

create policy "commission_rules owner access"
  on commission_rules for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Total fees attributed to this trade: the entry-side fee once it's open,
-- plus the exit-side fee once it's closed. Stored as a real column (not
-- derived at read time) because trades.dollar_pl is stored *net* of it --
-- see src/lib/trades/compute.ts. Keeping dollar_pl net is what lets every
-- existing aggregate (dashboard, analytics, insights, ask, account balance,
-- and the dashboard_stats RPC in 0020/0021) stay correct without change:
-- they all sum dollar_pl, and the number they sum is now what actually hit
-- the account.
alter table trades add column commission numeric;

-- True when the user typed a commission on the trade by hand, which pins it
-- against the automatic per-rule recalculation. Without this flag, editing
-- any other field on the trade would silently overwrite the manual value.
alter table trades add column commission_manual boolean not null default false;
