-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it (0025 must already be applied -- this replaces the same function).
--
-- best_row and worst_row picked their setup with two independent
-- `order by ... limit 1` queries (desc, asc) and no secondary sort key. For
-- strategies tied on total_pl, SQL's ORDER BY gives no guarantee the two
-- queries land on the same row -- so a genuine tie could show two *different*
-- arbitrary strategy names as "best" and "worst", or the same name as both,
-- either way implying a distinction that doesn't exist. The JS fallback
-- (getBestWorstSetup, dashboard/queries.ts) already nulls worst out on a tie;
-- this brings the RPC in line with it.
--
-- Fixed by comparing the two rows' totalPL rather than their tags -- tag
-- equality isn't reliable here for the reason above, but value equality is
-- exactly what "tied" means. This also folds in the old `count(*) > 1` guard
-- for a single strategy: with one row, best and worst are the same row by
-- construction, so their totalPL is trivially equal and worst comes out
-- null the same way. Only best_row/worst_row and the final worst_setup
-- expression change; everything else is identical to 0025.

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
        (select sum(dollar_pl) from trades where user_id = auth.uid() and status = 'closed' and dollar_pl is not null),
        0
      ) as v_trade_pl,
      coalesce(
        (
          select sum(
            case
              when mode = 'investment' then
                case
                  when custom_fields->>'average_cost' ~ '^-?[0-9]+(\.[0-9]+)?$'
                   and custom_fields->>'total_shares' ~ '^-?[0-9]+(\.[0-9]+)?$'
                  then (custom_fields->>'average_cost')::numeric * (custom_fields->>'total_shares')::numeric
                  else 0
                end
              else
                coalesce(position_size, case when entry_price is not null and shares is not null
                  then entry_price * shares end, 0)
            end
          )
          from trades
          where user_id = auth.uid() and status = 'open'
        ),
        0
      ) as v_committed_cash,
      exists(select 1 from account_transactions where user_id = auth.uid()) as v_has_tx
  ),
  setup_stats as (
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
  -- CHANGED (0026): raw columns rather than pre-built jsonb, so the final
  -- select can compare best/worst by value before deciding whether to emit
  -- worst_setup at all.
  best_row as (
    select setup_tag, setup_trades, setup_wins, setup_total_pl
    from setup_stats order by setup_total_pl desc limit 1
  ),
  worst_row as (
    select setup_tag, setup_trades, setup_wins, setup_total_pl
    from setup_stats order by setup_total_pl asc limit 1
  )
  select
    status_counts.n_all, status_counts.n_pending,
    status_counts.n_open, status_counts.n_closed,
    win_stats.n_closed_total, win_stats.n_wins,
    today_stats.v_today_pl,
    monthly_stats.v_monthly_pl,
    account_stats.v_deposited, account_stats.v_trade_pl,
    account_stats.v_committed_cash, account_stats.v_has_tx,
    (
      select jsonb_build_object(
        'tag', setup_tag, 'trades', setup_trades, 'wins', setup_wins, 'totalPL', setup_total_pl
      )
      from best_row
    ),
    -- CHANGED (0026): null whenever worst's total ties best's -- covers the
    -- single-strategy case (best_row and worst_row are the same row, so
    -- trivially equal) and any genuine tie at either extreme, without
    -- trusting SQL's unspecified ORDER BY tie-break to pick matching rows.
    case
      when (select setup_total_pl from worst_row) = (select setup_total_pl from best_row) then null
      else (
        select jsonb_build_object(
          'tag', setup_tag, 'trades', setup_trades, 'wins', setup_wins, 'totalPL', setup_total_pl
        )
        from worst_row
      )
    end
  from status_counts, win_stats, today_stats, monthly_stats, account_stats;
end;
$$;

grant execute on function dashboard_stats(timestamptz, timestamptz, timestamptz, timestamptz, text) to authenticated;
