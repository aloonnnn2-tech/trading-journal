-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
--
-- trade_history grows without bound: the 0008 trigger snapshots the full
-- trade row as jsonb on EVERY update, and updates arrive every 600ms from
-- the autosave debounce while a trade is being edited. One active editing
-- session writes dozens of full-row snapshots; nothing ever deleted any of
-- them. This caps retention at the newest 50 snapshots per trade -- far
-- more than the version-history panel meaningfully surfaces, while keeping
-- storage and the history query bounded.
--
-- Done inside the same trigger rather than a scheduled job so it needs no
-- extra infrastructure and can never fall behind: each insert prunes its
-- own trade's tail, using the existing (trade_id, created_at desc) index.
-- The one-time cleanup at the bottom trims history already accumulated.

create or replace function snapshot_trade_history()
returns trigger as $$
begin
  insert into trade_history (trade_id, user_id, snapshot)
  values (old.id, old.user_id, to_jsonb(old));

  -- Keep the newest 50 rows for this trade, delete the rest. Ties on
  -- created_at (bulk writes land in the same instant) are broken by id so
  -- the boundary is deterministic.
  delete from trade_history
  where trade_id = old.id
    and id not in (
      select id from trade_history
      where trade_id = old.id
      order by created_at desc, id desc
      limit 50
    );

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- The trigger itself is unchanged (same name, same timing) -- only the
-- function body above is replaced. Re-stated here so this migration is
-- self-sufficient if 0008's trigger was ever dropped:
drop trigger if exists trades_snapshot_history on trades;
create trigger trades_snapshot_history
  before update on trades
  for each row
  execute function snapshot_trade_history();

-- One-time cleanup of history that accumulated before this migration.
delete from trade_history h
where h.id not in (
  select id from (
    select id, row_number() over (partition by trade_id order by created_at desc, id desc) as rn
    from trade_history
  ) ranked
  where rn <= 50
);
