-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically -- see
-- supabase/migrations/*.sql for the existing convention.
--
-- Extends the admin panel from aggregates to individual users, and adds an
-- anonymous homepage-visit counter. Four pieces:
--
--   1. admin_user_directory()      one row per user: trades, sessions, activity
--   2. admin_user_detail(uuid,int)  one user's event counts, clicks, pages, timeline
--   3. public_page_views + record_public_view(text) + admin_public_views(int)
--                                  an identity-free count of homepage views
--   4. prune_click_events(int)      retention for the new per-click events
--
-- Every admin function is security definer with its own is_admin check, per
-- the pattern 0013 established: auth.users is not exposed through PostgREST,
-- so email and signup date can only come through a definer function, and the
-- page-level redirect must not be the only gate. Each returns COUNTS AND
-- TIMESTAMPS ONLY -- never a trade row, ticker, note or P&L figure. The
-- privacy policy says trade contents never reach analytics; these functions
-- are written so that stays true even for an admin.
--
-- Output columns are named to avoid every table column they touch
-- (`id` not `user_id`, `admin` not `is_admin`, `signed_up_at` not
-- `created_at`) and every reference is table-qualified. PL/pgSQL raises on an
-- ambiguous name between an OUT column and a table column, and that error
-- only appears at call time, after the file has "applied" cleanly.

-- 1. Directory ---------------------------------------------------------------

create or replace function admin_user_directory()
returns table (
  id uuid,
  email text,
  signed_up_at timestamptz,
  plan text,
  admin boolean,
  trade_count bigint,
  open_trades bigint,
  closed_trades bigint,
  session_count bigint,
  active_seconds bigint,
  last_active_at timestamptz,
  events_total bigint,
  clicks_total bigint,
  trades_created bigint,
  trades_edited bigint,
  trades_deleted bigint,
  imports bigint,
  ai_questions bigint,
  ai_reviews bigint,
  exports bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from user_settings us where us.user_id = auth.uid() and us.is_admin) then
    raise exception 'not authorized';
  end if;

  return query
  select
    u.id,
    u.email::text,
    u.created_at,
    coalesce(s.plan, 'free'),
    coalesce(s.is_admin, false),
    coalesce(t.trade_count, 0),
    coalesce(t.open_trades, 0),
    coalesce(t.closed_trades, 0),
    coalesce(ss.session_count, 0),
    coalesce(ss.active_seconds, 0),
    ss.last_active_at,
    coalesce(ev.events_total, 0),
    coalesce(ev.clicks_total, 0),
    coalesce(ev.trades_created, 0),
    coalesce(ev.trades_edited, 0),
    coalesce(ev.trades_deleted, 0),
    coalesce(ev.imports, 0),
    coalesce(ev.ai_questions, 0),
    coalesce(ev.ai_reviews, 0),
    coalesce(ev.exports, 0)
  from auth.users u
  left join user_settings s on s.user_id = u.id
  left join (
    select tr.user_id,
           count(*) as trade_count,
           count(*) filter (where tr.status in ('open', 'pending')) as open_trades,
           count(*) filter (where tr.status = 'closed') as closed_trades
    from trades tr
    group by tr.user_id
  ) t on t.user_id = u.id
  left join (
    select se.user_id,
           count(*) as session_count,
           coalesce(sum(se.duration_seconds), 0)::bigint as active_seconds,
           max(se.last_seen_at) as last_active_at
    from analytics_sessions se
    group by se.user_id
  ) ss on ss.user_id = u.id
  left join (
    select e.user_id,
           count(*) as events_total,
           count(*) filter (where e.event_name = 'click') as clicks_total,
           count(*) filter (where e.event_name = 'trade_created') as trades_created,
           count(*) filter (where e.event_name = 'trade_edited') as trades_edited,
           count(*) filter (where e.event_name = 'trade_deleted') as trades_deleted,
           count(*) filter (where e.event_name = 'import_used') as imports,
           count(*) filter (where e.event_name = 'ai_question_answered') as ai_questions,
           count(*) filter (where e.event_name = 'ai_review_generated') as ai_reviews,
           count(*) filter (where e.event_name = 'export_used') as exports
    from analytics_events e
    group by e.user_id
  ) ev on ev.user_id = u.id
  order by ss.last_active_at desc nulls last, u.created_at desc;
end;
$$;

revoke all on function admin_user_directory() from public;
grant execute on function admin_user_directory() to authenticated;

-- 2. One user's detail -------------------------------------------------------
--
-- Returns jsonb rather than a table because a detail page wants four shapes
-- at once (event counts, click labels, page paths, a timeline); one call
-- beats four round-trips and the page renders them together anyway.
-- `recent_events` carries event_props verbatim: those are ids, paths and
-- click labels -- metadata by construction (see click-capture.ts for the
-- rule that keeps user content out of labels).

create or replace function admin_user_detail(p_user_id uuid, p_days int default 90)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  since timestamptz := now() - (p_days || ' days')::interval;
  result jsonb;
begin
  if not exists (select 1 from user_settings us where us.user_id = auth.uid() and us.is_admin) then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'event_counts', (
      select coalesce(jsonb_agg(jsonb_build_object('event_name', x.event_name, 'count', x.c) order by x.c desc), '[]'::jsonb)
      from (
        select e.event_name, count(*) as c
        from analytics_events e
        where e.user_id = p_user_id and e.created_at >= since
        group by e.event_name
      ) x
    ),
    'top_clicks', (
      select coalesce(jsonb_agg(jsonb_build_object('label', x.label, 'count', x.c) order by x.c desc), '[]'::jsonb)
      from (
        select coalesce(e.event_props->>'label', '(unlabelled)') as label, count(*) as c
        from analytics_events e
        where e.user_id = p_user_id and e.event_name = 'click' and e.created_at >= since
        group by 1
        order by 2 desc
        limit 30
      ) x
    ),
    'top_pages', (
      select coalesce(jsonb_agg(jsonb_build_object('path', x.path, 'count', x.c) order by x.c desc), '[]'::jsonb)
      from (
        select coalesce(e.event_props->>'path', '?') as path, count(*) as c
        from analytics_events e
        where e.user_id = p_user_id and e.event_name = 'page_view' and e.created_at >= since
        group by 1
        order by 2 desc
        limit 20
      ) x
    ),
    'recent_events', (
      select coalesce(jsonb_agg(jsonb_build_object('created_at', x.created_at, 'event_name', x.event_name, 'props', x.event_props) order by x.created_at desc), '[]'::jsonb)
      from (
        select e.created_at, e.event_name, e.event_props
        from analytics_events e
        where e.user_id = p_user_id
        order by e.created_at desc
        limit 100
      ) x
    )
  ) into result;

  return result;
end;
$$;

revoke all on function admin_user_detail(uuid, int) from public;
grant execute on function admin_user_detail(uuid, int) to authenticated;

-- 3. Anonymous homepage-visit counter ---------------------------------------
--
-- The one piece here that runs for logged-out visitors, and it is built so
-- that it stores NOTHING about them: one integer per (day, path). No cookie,
-- no session id, no IP, no user agent. That is what keeps it outside the
-- consent question the privacy policy and SECURITY.md §4 rest on -- nothing
-- is written to or read from the visitor's device, and nothing here can be
-- tied to a person.

create table if not exists public_page_views (
  day date not null,
  path text not null,
  views integer not null default 0,
  primary key (day, path)
);

-- LOCKED DOWN, as 0040 explains: Supabase grants anon/authenticated full
-- access to any new public table by default, which would make this reachable
-- through PostgREST directly. Revoke removes the endpoint; RLS with no
-- policies is the second lock. Only the two definer functions below touch it.
revoke all on public_page_views from anon, authenticated;
alter table public_page_views enable row level security;

create or replace function record_public_view(p_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Allowlisted, so an unauthenticated caller cannot seed the table with
  -- arbitrary strings. Anything else raises rather than silently no-ops, so a
  -- typo in the beacon shows up as an error instead of as missing data.
  if p_path not in ('/', '/paid-plan', '/privacy', '/terms', '/cookies', '/contact') then
    raise exception 'path not tracked';
  end if;

  insert into public_page_views as v (day, path, views)
    values (current_date, p_path, 1)
  on conflict (day, path) do update
    set views = v.views + 1;
end;
$$;

-- Callable with no session: that is the whole point. The worst an abuser can
-- do is inflate a counter, and the proxy's anonymous per-IP rate limit bounds
-- how fast.
revoke all on function record_public_view(text) from public;
grant execute on function record_public_view(text) to anon, authenticated;

create or replace function admin_public_views(p_days int default 30)
returns table (day date, views bigint, signups bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from user_settings us where us.user_id = auth.uid() and us.is_admin) then
    raise exception 'not authorized';
  end if;

  return query
  with days as (
    select generate_series(current_date - (p_days - 1), current_date, interval '1 day')::date as day
  ),
  v as (
    select pv.day, sum(pv.views)::bigint as views
    from public_page_views pv
    where pv.path = '/'
    group by pv.day
  ),
  s as (
    select u.created_at::date as day, count(*) as signups
    from auth.users u
    group by 1
  )
  select d.day, coalesce(v.views, 0), coalesce(s.signups, 0)
  from days d
  left join v on v.day = d.day
  left join s on s.day = d.day
  order by d.day;
end;
$$;

revoke all on function admin_public_views(int) from public;
grant execute on function admin_public_views(int) to authenticated;

-- 4. Retention for click events --------------------------------------------
--
-- Every click is now a row, which is the one thing in analytics_events that
-- can grow without bound. This drops click rows past the cutoff and leaves
-- the meaningful-action events (trade_created and friends) untouched, so the
-- long-run per-user picture survives while the raw click log stays bounded.
-- Called nightly from api/cron/auto-execute with the service-role client.

create or replace function prune_click_events(p_days int default 90)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted bigint;
begin
  delete from analytics_events e
  where e.event_name = 'click'
    and e.created_at < now() - (p_days || ' days')::interval;
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke all on function prune_click_events(int) from public;
grant execute on function prune_click_events(int) to service_role;

-- Self-records per the convention in 0040_schema_migrations.sql.
insert into schema_migrations (filename)
values ('0043_admin_users.sql')
on conflict do nothing;
