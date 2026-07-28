-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role key in this project, so
-- migrations are never applied automatically -- see supabase/migrations/*.sql
-- for the existing convention (0013_analytics.sql, 0015_fix_overview_stats.sql).
--
-- PERF-2: the dashboard fires ~12 separate count/aggregate queries per page
-- view (status counts, win rate, today's P/L, monthly P/L, best/worst setup,
-- account balance) on top of the queries that fetch actual rows for lists
-- and charts. This collapses just the count/aggregate ones into a single
-- RPC call, callable via supabase.rpc("dashboard_stats", {...}).
--
-- Not security definer: unlike the admin_* RPCs in 0013_analytics.sql (which
-- need definer to read auth.users, a table RLS can't touch), this only reads
-- trades/account_transactions, both already RLS-scoped to auth.uid() via
-- their existing "owner access" policies -- a plain (invoker) function gets
-- the same protection today's per-row queries already rely on.
--
-- Note: an earlier version of this function was intentionally bug-compatible
-- with the JS it replaced (counting investment-mode trades into win-rate/
-- setup denominators they can never win). The task-4 investment-mode audit
-- fixed that same bug in the JS (analytics/ask/insights/getWinRate/
-- getBestWorstSetup all gained a `mode <> 'investment'` filter) -- win_stats
-- and setup_stats below carry the identical fix, so this function matches
-- the now-fixed JS rather than reproducing the old bug.
--
-- Every internal CTE column below is deliberately named *differently* from
-- the OUT columns in `returns table` -- plpgsql exposes OUT parameters as
-- variables in scope through the whole function body, so a CTE column alias
-- that happens to match one (e.g. naming a CTE column `wins` when `wins` is
-- also an OUT column) makes any later bare reference to that name
-- genuinely ambiguous to the parser (error 42702, caught by testing this
-- live against the demo account after applying the migration -- not caught
-- by writing the SQL alone).

create or replace function dashboard_stats(
  p_today_start timestamptz,
  p_today_end timestamptz,
  p_month_start timestamptz,
  p_month_end timestamptz,
  p_timezone text
)
returns table (
  status_all bigint,
  status_pending bigint,
  status_open bigint,
  status_closed bigint,
  closed_total bigint,
  wins bigint,
  today_pl numeric,
  monthly_pl jsonb,
  deposited numeric,
  trade_pl numeric,
  committed_cash numeric,
  has_transactions boolean,
  best_setup jsonb,
  worst_setup jsonb
)
language plpgsql
as $$
begin
  return query
  with
  status_counts as (
    select
      count(*) as n_all,
      count(*) filter (where status = 'pending') as n_pending,
      count(*) filter (where status = 'open') as n_open,
      count(*) filter (where status = 'closed') as n_closed
    from trades
    where user_id = auth.uid()
  ),
  win_stats as (
    -- Matches getWinRate()'s definition: dollar_pl > 0, not the result
    -- column, restricted to rows with a non-null exit_date, and excluding
    -- investment-mode trades (always-null dollar_pl -> automatic non-win,
    -- which inflated this denominator) -- same filters the
    -- analytics/insights/ask pages and getWinRate() itself use.
    select
      count(*) as n_closed_total,
      count(*) filter (where dollar_pl > 0) as n_wins
    from trades
    where user_id = auth.uid() and status = 'closed' and exit_date is not null
      and mode <> 'investment'
  ),
  today_stats as (
    select coalesce(sum(dollar_pl), 0) as v_today_pl
    from trades
    where user_id = auth.uid() and status = 'closed'
      and exit_date >= p_today_start and exit_date < p_today_end
  ),
  monthly_stats as (
    select coalesce(
      jsonb_agg(jsonb_build_object('day', day_num, 'dollar_pl', day_pl)),
      '[]'::jsonb
    ) as v_monthly_pl
    from (
      select
        extract(day from (exit_date at time zone p_timezone))::int as day_num,
        sum(dollar_pl) as day_pl
      from trades
      where user_id = auth.uid() and status = 'closed'
        and exit_date >= p_month_start and exit_date < p_month_end
      group by 1
    ) by_day
  ),
  account_stats as (
    select
      coalesce((select sum(amount) from account_transactions where user_id = auth.uid()), 0) as v_deposited,
      coalesce(
        (select sum(dollar_pl) from trades where user_id = auth.uid() and dollar_pl is not null),
        0
      ) as v_trade_pl,
      coalesce(
        (
          select sum(coalesce(position_size, case when entry_price is not null and shares is not null
            then entry_price * shares end, 0))
          from trades
          where user_id = auth.uid() and status = 'open'
        ),
        0
      ) as v_committed_cash,
      exists(select 1 from account_transactions where user_id = auth.uid()) as v_has_tx
  ),
  setup_stats as (
    -- Matches getBestWorstSetup(): best/worst strategy tag by total P/L
    -- across closed trades, mirroring its flatMap(link => link.strategies)
    -- many-to-one unwrap via the join below.
    select
      s.name as setup_tag,
      count(*) as setup_trades,
      count(*) filter (where t.dollar_pl > 0) as setup_wins,
      sum(t.dollar_pl) as setup_total_pl
    from trades t
    join trade_strategies ts on ts.trade_id = t.id
    join strategies s on s.id = ts.strategy_id
    where t.user_id = auth.uid() and t.status = 'closed' and t.mode <> 'investment'
    group by s.name
  ),
  best_row as (
    select jsonb_build_object(
      'tag', setup_tag, 'trades', setup_trades, 'wins', setup_wins, 'totalPL', setup_total_pl
    ) as v_best_setup
    from setup_stats order by setup_total_pl desc limit 1
  ),
  worst_row as (
    select jsonb_build_object(
      'tag', setup_tag, 'trades', setup_trades, 'wins', setup_wins, 'totalPL', setup_total_pl
    ) as v_worst_setup
    from setup_stats
    where (select count(*) from setup_stats) > 1
    order by setup_total_pl asc limit 1
  )
  select
    status_counts.n_all, status_counts.n_pending,
    status_counts.n_open, status_counts.n_closed,
    win_stats.n_closed_total, win_stats.n_wins,
    today_stats.v_today_pl,
    monthly_stats.v_monthly_pl,
    account_stats.v_deposited, account_stats.v_trade_pl,
    account_stats.v_committed_cash, account_stats.v_has_tx,
    (select v_best_setup from best_row),
    (select v_worst_setup from worst_row)
  from status_counts, win_stats, today_stats, monthly_stats, account_stats;
end;
$$;

grant execute on function dashboard_stats(timestamptz, timestamptz, timestamptz, timestamptz, text) to authenticated;
