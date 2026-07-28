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
-- Intentionally bug-compatible with the current JS implementation it
-- replaces (including counting investment-mode trades into win-rate/setup
-- denominators they can never win -- see missing-fields.ts's isInvestment
-- handling for context). That investment-mode fix is a separate, deliberate
-- change layered on afterward, not bundled into this refactor.

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
      count(*) as status_all,
      count(*) filter (where status = 'pending') as status_pending,
      count(*) filter (where status = 'open') as status_open,
      count(*) filter (where status = 'closed') as status_closed
    from trades
    where user_id = auth.uid()
  ),
  win_rate as (
    -- Matches getWinRate()'s definition: dollar_pl > 0, not the result
    -- column, and restricted to rows with a non-null exit_date -- same
    -- filter the analytics/insights/ask pages already use.
    select
      count(*) as closed_total,
      count(*) filter (where dollar_pl > 0) as wins
    from trades
    where user_id = auth.uid() and status = 'closed' and exit_date is not null
  ),
  today as (
    select coalesce(sum(dollar_pl), 0) as today_pl
    from trades
    where user_id = auth.uid() and status = 'closed'
      and exit_date >= p_today_start and exit_date < p_today_end
  ),
  monthly as (
    select coalesce(
      jsonb_agg(jsonb_build_object('day', day, 'dollar_pl', dollar_pl)),
      '[]'::jsonb
    ) as monthly_pl
    from (
      select
        extract(day from (exit_date at time zone p_timezone))::int as day,
        sum(dollar_pl) as dollar_pl
      from trades
      where user_id = auth.uid() and status = 'closed'
        and exit_date >= p_month_start and exit_date < p_month_end
      group by 1
    ) by_day
  ),
  account as (
    select
      coalesce((select sum(amount) from account_transactions where user_id = auth.uid()), 0) as deposited,
      coalesce(
        (select sum(dollar_pl) from trades where user_id = auth.uid() and dollar_pl is not null),
        0
      ) as trade_pl,
      coalesce(
        (
          select sum(coalesce(position_size, case when entry_price is not null and shares is not null
            then entry_price * shares end, 0))
          from trades
          where user_id = auth.uid() and status = 'open'
        ),
        0
      ) as committed_cash,
      exists(select 1 from account_transactions where user_id = auth.uid()) as has_transactions
  ),
  setup_stats as (
    -- Matches getBestWorstSetup(): best/worst strategy tag by total P/L
    -- across closed trades, mirroring its flatMap(link => link.strategies)
    -- many-to-one unwrap via the join below.
    select
      s.name as tag,
      count(*) as trades,
      count(*) filter (where t.dollar_pl > 0) as wins,
      sum(t.dollar_pl) as total_pl
    from trades t
    join trade_strategies ts on ts.trade_id = t.id
    join strategies s on s.id = ts.strategy_id
    where t.user_id = auth.uid() and t.status = 'closed'
    group by s.name
  ),
  best as (
    select jsonb_build_object(
      'tag', tag, 'trades', trades, 'wins', wins, 'totalPL', total_pl
    ) as best_setup
    from setup_stats order by total_pl desc limit 1
  ),
  worst as (
    select jsonb_build_object(
      'tag', tag, 'trades', trades, 'wins', wins, 'totalPL', total_pl
    ) as worst_setup
    from setup_stats
    where (select count(*) from setup_stats) > 1
    order by total_pl asc limit 1
  )
  select
    status_counts.status_all, status_counts.status_pending,
    status_counts.status_open, status_counts.status_closed,
    win_rate.closed_total, win_rate.wins,
    today.today_pl,
    monthly.monthly_pl,
    account.deposited, account.trade_pl, account.committed_cash, account.has_transactions,
    (select best_setup from best),
    (select worst_setup from worst)
  from status_counts, win_rate, today, monthly, account;
end;
$$;

grant execute on function dashboard_stats(timestamptz, timestamptz, timestamptz, timestamptz, text) to authenticated;
