-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. This project has no migration runner -- see the header of every
-- other file in supabase/migrations.
--
-- Order types, a custom escape hatch, and time in force.
--
-- WHAT THIS FIXES, NOT JUST WHAT IT ADDS. Until now the app stored a single
-- trigger price with no order sub-type, so auto-execution had to fill a
-- pending order whenever the session's range merely BRACKETED that price
-- (src/lib/trades/auto-execute.ts said so in as many words). A buy limit at
-- $95 therefore filled when price ROSE through $95, which is not what a limit
-- order does. Recording the type is what lets the fill be directional.
--
-- ORDER TYPE IS text + CHECK, NOT A POSTGRES ENUM. `status` is an enum and
-- extending it needs ALTER TYPE ... ADD VALUE, which cannot be used in the
-- same transaction that adds it and is awkward to roll back. This column will
-- gain values over time, so a CHECK constraint that can be replaced in one
-- statement is the better shape.

alter table trades
  add column order_type text
    check (order_type in ('market', 'limit', 'stop', 'stop_limit', 'trailing_stop', 'other')),

  -- Only meaningful when order_type = 'other'. Bounded for the same reason
  -- ticker and company_name are bounded in lib/trades/schema.ts: this column
  -- rides into every CSV/XLSX export and renders in the trades table, and
  -- Postgres `text` would otherwise accept a pasted document.
  add column order_type_other text check (char_length(order_type_other) <= 64),

  -- The second price a stop-limit needs: the stop triggers, then the order
  -- rests as a limit at this price. Null for every other type.
  add column limit_price numeric,

  -- Good-til-cancelled is the default because it is what the app already did
  -- implicitly: a pending order sat there until it filled or the user removed
  -- it. Existing rows therefore keep behaving exactly as they do today.
  add column time_in_force text not null default 'gtc'
    check (time_in_force in ('gtc', 'day'));

-- A day order that never filled is not "closed" -- it never opened, so it has
-- no entry, no exit and no P&L. It needs a state of its own.
--
-- Safe to add: every statistic in this app selects `status = 'closed'` and the
-- committed-cash RPC selects `status in ('open', 'pending')`. Both are
-- positive predicates, checked across 0021/0025/0027 and every query in
-- src/lib, so a new value cannot leak into a number. It simply stops matching.
--
-- If the SQL editor rejects this with "ALTER TYPE ... cannot run inside a
-- transaction block", run this one line on its own first, then the rest.
alter type trade_status add value if not exists 'expired';

-- Finding resting orders to sweep. The auto-execute job reads pending orders
-- across every user, and day orders now need an expiry check on top of the
-- fill check, so both go through this.
create index if not exists trades_pending_tif_idx
  on trades (status, time_in_force)
  where status = 'pending';

comment on column trades.order_type is
  'Null means unspecified. Auto-execution keeps its original bracket behaviour for null, so applying this migration cannot change how an existing resting order fills.';
