-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
-- Apply after 0078. Safe before or after the code: without the column the
-- "Sell part" button explains that it isn't switched on yet, and every
-- trade behaves exactly as before. Existing trades get an empty list.
-- Down (in this order):
--   re-run 0027's dashboard_stats, then 0073's "alter function dashboard_stats ... set search_path";
--   drop function if exists public.trade_partial_realized(jsonb, numeric, text);
--   drop function if exists public.trade_held_fraction(jsonb, numeric);
--   drop function if exists public.trade_partial_sales(jsonb);
--   alter table public.trades drop column if exists partial_exits;
--
-- Partial sells (2026-10-29). Alon: "a user logs a trade, then after some
-- time wants to sell part of his shares -- an earnings report, or to reduce
-- risk -- so make an easy way to log that, and make sure the AI trade review
-- understands it."
--
-- Each sale is one element: { id, date, shares, price, reason, note, fee }.
-- The shares still held are shares minus the shares sold; exit_price is the
-- price the REST was sold at. dollar_pl adds up every sale plus that final
-- exit (src/lib/trades/compute.ts), so every total in the app counts them.
--
-- The app validates each sale (src/lib/trades/partial-exits.ts); these
-- checks only bound what a request could store if it got past that.

alter table public.trades
  add column if not exists partial_exits jsonb not null default '[]'::jsonb;

alter table public.trades drop constraint if exists trades_partial_exits_shape;
alter table public.trades
  add constraint trades_partial_exits_shape check (
    jsonb_typeof(partial_exits) = 'array'
    and jsonb_array_length(partial_exits) <= 50
    and octet_length(partial_exits::text) <= 32768
  );


-- ---------------------------------------------------------------------------
-- The dashboard's cash figures (dashboard_stats) count sales too, matching
-- getAccountBalance in src/lib/account/queries.ts: a sale's profit has
-- landed even while the rest is held, and the sold part no longer ties up
-- cash. Only well-formed sales count (a number for shares and price), so a
-- hand-edited value can't make the dashboard fail.

create or replace function public.trade_partial_sales(p_sales jsonb)
returns table (shares numeric, price numeric)
language sql
immutable
set search_path = public, pg_temp
as $$
  select (e->>'shares')::numeric, (e->>'price')::numeric
  from jsonb_array_elements(case when jsonb_typeof(p_sales) = 'array' then p_sales else '[]'::jsonb end) e
  where e->>'shares' ~ '^[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$'
    and e->>'price' ~ '^[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$'
$$;

-- The share of the position still held: 1 with no sales.
create or replace function public.trade_held_fraction(p_sales jsonb, p_shares numeric)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_shares is null or p_shares = 0 then 1
    else greatest(abs(p_shares) - coalesce((select sum(s.shares) from trade_partial_sales(p_sales) s), 0), 0)
         / abs(p_shares)
  end
$$;

-- Profit taken by the sales so far, before fees.
create or replace function public.trade_partial_realized(p_sales jsonb, p_entry numeric, p_direction text)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_entry is null then 0
    else coalesce(
      (select sum((s.price - p_entry) * s.shares) from trade_partial_sales(p_sales) s), 0
    ) * case when p_direction = 'short' then -1 else 1 end
  end
$$;

revoke execute on function public.trade_partial_sales(jsonb) from public, anon;
revoke execute on function public.trade_held_fraction(jsonb, numeric) from public, anon;
revoke execute on function public.trade_partial_realized(jsonb, numeric, text) from public, anon;
grant execute on function public.trade_partial_sales(jsonb) to authenticated;
grant execute on function public.trade_held_fraction(jsonb, numeric) to authenticated;
grant execute on function public.trade_partial_realized(jsonb, numeric, text) to authenticated;

-- dashboard_stats as in 0027 (with 0073's search_path), two lines changed,
-- marked CHANGED (0079). create or replace keeps its grants.

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
set search_path = public, pg_temp
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
      )
      -- CHANGED (0079): plus partial sells on positions still open.
      + coalesce(
        (
          select sum(trade_partial_realized(partial_exits, entry_price, direction))
          from trades
          where user_id = auth.uid() and status = 'open' and mode <> 'investment'
        ),
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
                -- CHANGED (0079): only the part still held.
                * trade_held_fraction(partial_exits, shares)
            end
          )
          -- CHANGED (0027): open AND pending -- see header comment.
          from trades
          where user_id = auth.uid() and status in ('open', 'pending')
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

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0079_partial_exits.sql')
on conflict do nothing;
