-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
-- Safe to apply before or after the code: the app only reads these columns
-- when they exist, and nothing sets them except the trigger below and the
-- user answering the question.
--
-- "At what price did it fill?" (Alon, 2026-10-10).
--
-- When a resting order fills, the app has to assume the price: a stop at its
-- stop, a limit at its limit, a stop-limit at its limit (auto-execute.ts).
-- Real fills often differ -- a stop slips through its level on a gap, a
-- stop-limit can fill anywhere between its two prices -- and the entry price
-- drives every P/L and R figure in the app. So the trade card asks.
--
-- A trigger rather than app code, so all three ways an order fills ask the
-- same question: the user switching Status by hand, the trade page's live
-- price watch, and the 15-minute background sweep (service role).
--
--   fill_price_confirmed  null  = nothing to ask (every existing trade, and
--                                 market orders, which fill at the market)
--                         false = ask on the trade card
--                         true  = answered
--   order_price           the resting order's own price at the moment it
--                         filled (the stop of a stop-limit, which the fill
--                         itself overwrites with the limit), so the question
--                         can say where the fill should be.

alter table trades
  add column if not exists fill_price_confirmed boolean,
  add column if not exists order_price numeric;

create or replace function flag_fill_to_confirm()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'pending'
     and new.status in ('open', 'closed')
     and new.order_type in ('limit', 'stop', 'stop_limit', 'trailing_stop')
  then
    new.fill_price_confirmed := false;
    new.order_price := old.entry_price;
  elsif new.status = 'pending' and old.status <> 'pending' then
    -- Put back to pending (an undo): nothing has filled, nothing to ask.
    new.fill_price_confirmed := null;
    new.order_price := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trades_flag_fill_to_confirm on trades;
create trigger trades_flag_fill_to_confirm
  before update of status on trades
  for each row
  execute function flag_fill_to_confirm();

comment on column trades.fill_price_confirmed is
  'Null: nothing to ask. False: a resting order filled and the trade card asks for the real fill price. True: answered. Set by flag_fill_to_confirm (0063).';
comment on column trades.order_price is
  'The resting order''s own price when it filled (a stop-limit''s stop), for the fill-price question. Set by flag_fill_to_confirm (0063).';

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0063_fill_price_check.sql')
on conflict do nothing;
