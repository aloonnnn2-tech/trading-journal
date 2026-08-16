-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it.
--
-- trade_folders' and trade_strategies' RLS policies only ever checked that
-- the *folder*/*strategy* side belonged to the caller -- neither checked
-- that the *trade* being linked did too. A caller who knew (or guessed)
-- another user's trade id could PUT their own folder/strategy onto that
-- trade and the write would succeed: RLS approved it because the folder/
-- strategy was theirs, with nothing checking the trade side at all. The
-- API routes (src/app/api/trades/[id]/folders and .../strategies) trusted
-- the id from the URL the same way, so there was no check anywhere in the
-- stack. Fixed in the application layer too (setTradeFolders/
-- setTradeStrategies in src/lib/folders/queries.ts and
-- src/lib/strategies/queries.ts now verify the trade is the caller's own
-- before touching anything) -- this migration is the second, authoritative
-- layer: RLS is supposed to make this impossible regardless of what any
-- future caller's code does.

drop policy "trade_folders owner access" on trade_folders;

create policy "trade_folders owner access"
  on trade_folders for all
  using (
    exists (select 1 from folders f where f.id = folder_id and f.user_id = auth.uid())
    and exists (select 1 from trades t where t.id = trade_id and t.user_id = auth.uid())
  )
  with check (
    exists (select 1 from folders f where f.id = folder_id and f.user_id = auth.uid())
    and exists (select 1 from trades t where t.id = trade_id and t.user_id = auth.uid())
  );

drop policy "trade_strategies owner access" on trade_strategies;

create policy "trade_strategies owner access"
  on trade_strategies for all
  using (
    exists (select 1 from strategies s where s.id = strategy_id and s.user_id = auth.uid())
    and exists (select 1 from trades t where t.id = trade_id and t.user_id = auth.uid())
  )
  with check (
    exists (select 1 from strategies s where s.id = strategy_id and s.user_id = auth.uid())
    and exists (select 1 from trades t where t.id = trade_id and t.user_id = auth.uid())
  );
