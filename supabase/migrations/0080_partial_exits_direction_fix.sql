-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. Apply after 0079.
-- Down:
--   drop function if exists public.trade_partial_realized(jsonb, numeric, trade_direction);
--
-- Fixes 0079 (2026-10-29). dashboard_stats calls
-- trade_partial_realized(partial_exits, entry_price, direction), but
-- trades.direction is the trade_direction enum, not text, and Postgres
-- doesn't cast an enum to text when picking a function -- so the call
-- failed ("function trade_partial_realized(jsonb, numeric, trade_direction)
-- does not exist"). The dashboard fell back to its per-query path, which
-- gives the same numbers, so nothing showed wrong; this restores the fast
-- path. Found by e2e/partial-sells.spec.ts's server log on the dev project.

create or replace function public.trade_partial_realized(p_sales jsonb, p_entry numeric, p_direction trade_direction)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select trade_partial_realized(p_sales, p_entry, p_direction::text)
$$;

revoke execute on function public.trade_partial_realized(jsonb, numeric, trade_direction) from public, anon;
grant execute on function public.trade_partial_realized(jsonb, numeric, trade_direction) to authenticated;

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0080_partial_exits_direction_fix.sql')
on conflict do nothing;
