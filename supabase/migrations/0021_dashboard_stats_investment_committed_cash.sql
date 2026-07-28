-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it (0020 must already be applied -- this replaces the same function).
--
-- Follow-up to the task-4 investment-mode audit: getAccountBalance()'s
-- committedCash treated every open investment position as costing $0,
-- since investment trades don't have entry_price/shares/position_size (that
-- whole card is hidden -- see TradeCard.tsx's `{!isInvestment && ...}`).
-- Their cost basis instead lives in the seeded default custom fields
-- "Average Cost" (average_cost) and "Total Shares" (total_shares), per
-- supabase/migrations/0002_seed_default_fields.sql. Fixed in JS
-- (account/queries.ts's new investmentCostOf()) and mirrored here so the
-- RPC matches. A regex guard (rather than a bare ::numeric cast) means a
-- malformed/non-numeric custom field value degrades that one position to
-- $0 instead of raising an exception that would fail the whole RPC call --
-- same "incomplete position contributes nothing" behavior costOf() already
-- has for trade-mode positions.

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
        (select sum(dollar_pl) from trades where user_id = auth.uid() and dollar_pl is not null),
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
