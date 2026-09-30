-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
--
-- Choose the fee on a trade (Alon, 2026-09-29): someone with two brokers or
-- accounts picks which fee a trade pays, instead of relying only on the
-- automatic matching by asset type and market.
--
-- Null (every existing trade) = matched automatically, exactly as before.
-- Deleting a fee releases the trades that chose it back to matching.

alter table trades
  add column if not exists commission_rule_id uuid references commission_rules(id) on delete set null;

-- A trade may only point at a fee of its own owner. RLS on commission_rules
-- stops a user READING another user's fee, but a foreign key check is not
-- subject to RLS -- without this, a crafted PATCH could link a trade to
-- someone else's rule id. The route checks too; this is the backstop.
create or replace function trades_commission_rule_owner_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.commission_rule_id is not null and not exists (
    select 1 from commission_rules r where r.id = new.commission_rule_id and r.user_id = new.user_id
  ) then
    raise exception 'commission_rule_id must be one of the trade owner''s own fees';
  end if;
  return new;
end;
$$;

drop trigger if exists trades_commission_rule_owner on trades;
create trigger trades_commission_rule_owner
  before insert or update of commission_rule_id on trades
  for each row execute function trades_commission_rule_owner_check();

create index if not exists trades_commission_rule_id_idx on trades (commission_rule_id)
  where commission_rule_id is not null;

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0056_trade_commission_rule.sql')
on conflict do nothing;
