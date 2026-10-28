-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
-- Apply after 0077. Safe before or after the code: the code works without
-- these columns (every trade then behaves exactly as before), and existing
-- trades keep null, which also means "as before".
-- Down:
--   drop trigger if exists trades_stamp_level_times on public.trades;
--   drop function if exists public.trades_stamp_level_times();
--   alter table public.trades drop column if exists entry_levels_set_at,
--     drop column if exists stop_loss_set_at, drop column if exists take_profit_set_at;
--
-- When each price level was last set (2026-10-28). Alon: "I enter a stock,
-- it goes up, I set my stop above my entry, and Trading Lens takes that as
-- getting out of the stock." The automatic close compared the stop with the
-- whole day's low -- including the dip from BEFORE the stop was moved. With
-- these times it only counts prices after the level was set
-- (src/lib/trades/auto-execute.ts).
--
-- Stamped by the database, never by the browser: on insert every time is
-- now(), and on update a time changes only when its level does. Whatever a
-- request sends for these columns is overwritten.

alter table public.trades
  add column if not exists entry_levels_set_at timestamptz,
  add column if not exists stop_loss_set_at timestamptz,
  add column if not exists take_profit_set_at timestamptz;

create or replace function public.trades_stamp_level_times()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.entry_levels_set_at := now();
    new.stop_loss_set_at := now();
    new.take_profit_set_at := now();
    return new;
  end if;

  -- The entry side: the price, the limit leg, and the kind of order.
  if (new.entry_price, new.limit_price, new.order_type)
     is distinct from (old.entry_price, old.limit_price, old.order_type) then
    new.entry_levels_set_at := now();
  else
    new.entry_levels_set_at := old.entry_levels_set_at;
  end if;

  if new.stop_loss is distinct from old.stop_loss then
    new.stop_loss_set_at := now();
  else
    new.stop_loss_set_at := old.stop_loss_set_at;
  end if;

  if new.take_profit is distinct from old.take_profit then
    new.take_profit_set_at := now();
  else
    new.take_profit_set_at := old.take_profit_set_at;
  end if;

  return new;
end;
$$;

drop trigger if exists trades_stamp_level_times on public.trades;
create trigger trades_stamp_level_times
  before insert or update on public.trades
  for each row execute function public.trades_stamp_level_times();

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0078_trade_level_set_times.sql')
on conflict do nothing;
