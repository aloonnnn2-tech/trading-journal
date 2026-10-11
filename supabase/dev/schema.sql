-- GENERATED FILE -- do not edit. Rebuild with: npm run dev-schema
--
-- DEV SUPABASE PROJECT ONLY. Paste this whole file into the SQL editor of
-- the dev project (the one in .env.test.local), never the live one.
-- It runs as one transaction: if any statement fails, nothing is kept.
--
-- Contains 63 migrations: 0001_field_definitions_and_trades.sql .. 0063_fill_price_check.sql

-- ===== 0001_field_definitions_and_trades.sql =====
-- Milestone 0: field-definition engine + core trades schema
-- Schema evolution is additive-only: editing/removing a field_definition row
-- never mutates existing trades.custom_fields data.

create extension if not exists "pgcrypto";

create type entity_type as enum ('trade', 'investment');

create type field_type as enum (
  'text',
  'number',
  'date',
  'currency',
  'percentage',
  'dropdown',
  'multi_select',
  'checkbox',
  'rating',
  'large_notes',
  'tag',
  'color_picker'
);

create type trade_status as enum ('pending', 'open', 'closed');
create type trade_result as enum ('open', 'win', 'loss', 'break_even');
create type trade_direction as enum ('long', 'short');

-- Per-user, per-entity-type field schema. Default fields (notes sections,
-- emotion fields, etc.) are seeded as rows here per new user, not
-- hardcoded in the UI, so the template editor (Milestone 2) can treat
-- every field -- default or custom -- the same way.
create table field_definitions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type entity_type not null,
  key text not null,
  label text not null,
  field_type field_type not null,
  options jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, entity_type, key)
);

create index field_definitions_user_entity_idx
  on field_definitions (user_id, entity_type, sort_order);

-- Core trade table. Fixed columns cover everything needed for fast
-- filtering, sorting, and analytics (Milestones 4-5); custom_fields jsonb
-- holds every user-defined field's value, keyed by field_definitions.key.
create table trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode entity_type not null default 'trade',

  ticker text not null,
  company_name text,
  asset_type text,
  market text,
  direction trade_direction,

  status trade_status not null default 'pending',
  result trade_result not null default 'open',

  entry_price numeric,
  exit_price numeric,
  stop_loss numeric,
  take_profit numeric,
  shares numeric,
  position_size numeric,
  dollar_amount numeric,
  risk_amount numeric,
  risk_percent numeric,

  entry_date timestamptz,
  exit_date timestamptz,

  dollar_pl numeric,
  percent_return numeric,
  r_multiple numeric,
  risk_reward_ratio numeric,

  custom_fields jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index trades_user_status_idx on trades (user_id, status);
create index trades_user_entry_date_idx on trades (user_id, entry_date);
create index trades_custom_fields_gin_idx on trades using gin (custom_fields);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trades_set_updated_at
  before update on trades
  for each row
  execute function set_updated_at();

alter table field_definitions enable row level security;
alter table trades enable row level security;

create policy "field_definitions owner access"
  on field_definitions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "trades owner access"
  on trades for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ===== 0002_seed_default_fields.sql =====
-- Seeds default field_definitions rows for every new user so notes
-- sections and other spec-required defaults are just data, not
-- special-cased UI code. Runs once per new auth.users row.

create or replace function seed_default_field_definitions()
returns trigger as $$
begin
  insert into public.field_definitions (user_id, entity_type, key, label, field_type, sort_order, is_default)
  values
    (new.id, 'trade', 'notes_why_entered', 'Why did I take this trade?', 'large_notes', 100, true),
    (new.id, 'trade', 'notes_what_right', 'What did I do right?', 'large_notes', 101, true),
    (new.id, 'trade', 'notes_what_change', 'What would I change?', 'large_notes', 102, true),
    (new.id, 'trade', 'notes_lessons_learned', 'Lessons Learned', 'large_notes', 103, true),
    (new.id, 'trade', 'notes_additional', 'Additional Notes', 'large_notes', 104, true),
    (new.id, 'trade', 'emotion_before', 'Emotion Before Trade', 'tag', 110, true),
    (new.id, 'trade', 'emotion_during', 'Emotion During Trade', 'tag', 111, true),
    (new.id, 'trade', 'emotion_after', 'Emotion After Trade', 'tag', 112, true),
    (new.id, 'investment', 'average_cost', 'Average Cost', 'currency', 0, true),
    (new.id, 'investment', 'current_price', 'Current Price', 'currency', 1, true),
    (new.id, 'investment', 'total_shares', 'Total Shares', 'number', 2, true),
    (new.id, 'investment', 'total_value', 'Total Value', 'currency', 3, true),
    (new.id, 'investment', 'unrealized_gain_loss', 'Unrealized Gain/Loss', 'currency', 4, true),
    (new.id, 'investment', 'dividend_yield', 'Dividend Yield', 'percentage', 5, true),
    (new.id, 'investment', 'long_term_notes', 'Long-Term Notes', 'large_notes', 6, true);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created_seed_fields on auth.users;

create trigger on_auth_user_created_seed_fields
  after insert on auth.users
  for each row
  execute function seed_default_field_definitions();

-- ===== 0003_user_settings.sql =====
-- Per-user UI preferences, starting with which built-in (core column)
-- trade fields are hidden. Core columns can't be deleted like custom
-- fields (they're fixed columns used for fast filtering/analytics), but
-- users can still choose to hide ones they don't use, e.g. Stop Loss.

create table user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  hidden_core_fields text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger user_settings_set_updated_at
  before update on user_settings
  for each row
  execute function set_updated_at();

alter table user_settings enable row level security;

create policy "user_settings owner access"
  on user_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function seed_user_settings()
returns trigger as $$
begin
  insert into public.user_settings (user_id) values (new.id);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created_seed_settings
  after insert on auth.users
  for each row
  execute function seed_user_settings();

-- ===== 0004_folders.sql =====
-- Custom folders (Swing Trades, Day Trades, Crypto, etc.). A trade can
-- belong to multiple folders, hence the join table rather than a single
-- folder_id column on trades.

create table folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table trade_folders (
  trade_id uuid not null references trades(id) on delete cascade,
  folder_id uuid not null references folders(id) on delete cascade,
  primary key (trade_id, folder_id)
);

create index trade_folders_folder_idx on trade_folders (folder_id);

alter table folders enable row level security;
alter table trade_folders enable row level security;

create policy "folders owner access"
  on folders for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "trade_folders owner access"
  on trade_folders for all
  using (exists (select 1 from folders f where f.id = folder_id and f.user_id = auth.uid()))
  with check (exists (select 1 from folders f where f.id = folder_id and f.user_id = auth.uid()));

-- ===== 0005_search_indexes.sql =====
-- Fast partial-text search on ticker/company for the Milestone 4
-- search bar, plus the trgm extension it depends on. The existing
-- (user_id, status) and (user_id, entry_date) btree indexes from 0001
-- already cover status-tab filtering and date sorting.

create extension if not exists pg_trgm;

create index trades_ticker_trgm_idx on trades using gin (ticker gin_trgm_ops);
create index trades_company_name_trgm_idx on trades using gin (company_name gin_trgm_ops);

-- ===== 0006_strategy_tags_field.sql =====
-- Seeds a default "Strategy / Setup" tag field for trades, so tagging
-- strategies/setups is a first-class, filterable field instead of living
-- only in free-form custom_fields keys (e.g. the "setup_type" key some
-- imported trades have). on conflict do nothing makes the backfill for
-- existing users idempotent against the (user_id, entity_type, key)
-- unique constraint.
insert into field_definitions (user_id, entity_type, key, label, field_type, sort_order, is_default)
select id, 'trade', 'strategy_setup', 'Strategy / Setup', 'tag', 90, true
from auth.users
on conflict (user_id, entity_type, key) do nothing;

create or replace function seed_default_field_definitions()
returns trigger as $$
begin
  insert into public.field_definitions (user_id, entity_type, key, label, field_type, sort_order, is_default)
  values
    (new.id, 'trade', 'strategy_setup', 'Strategy / Setup', 'tag', 90, true),
    (new.id, 'trade', 'notes_why_entered', 'Why did I take this trade?', 'large_notes', 100, true),
    (new.id, 'trade', 'notes_what_right', 'What did I do right?', 'large_notes', 101, true),
    (new.id, 'trade', 'notes_what_change', 'What would I change?', 'large_notes', 102, true),
    (new.id, 'trade', 'notes_lessons_learned', 'Lessons Learned', 'large_notes', 103, true),
    (new.id, 'trade', 'notes_additional', 'Additional Notes', 'large_notes', 104, true),
    (new.id, 'trade', 'emotion_before', 'Emotion Before Trade', 'tag', 110, true),
    (new.id, 'trade', 'emotion_during', 'Emotion During Trade', 'tag', 111, true),
    (new.id, 'trade', 'emotion_after', 'Emotion After Trade', 'tag', 112, true),
    (new.id, 'investment', 'average_cost', 'Average Cost', 'currency', 0, true),
    (new.id, 'investment', 'current_price', 'Current Price', 'currency', 1, true),
    (new.id, 'investment', 'total_shares', 'Total Shares', 'number', 2, true),
    (new.id, 'investment', 'total_value', 'Total Value', 'currency', 3, true),
    (new.id, 'investment', 'unrealized_gain_loss', 'Unrealized Gain/Loss', 'currency', 4, true),
    (new.id, 'investment', 'dividend_yield', 'Dividend Yield', 'percentage', 5, true),
    (new.id, 'investment', 'long_term_notes', 'Long-Term Notes', 'large_notes', 6, true);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- ===== 0007_emotion_intensity_field.sql =====
-- Rounds out emotion tracking: adds a 1-10 intensity rating field (the
-- "rating" field type already supports min/max via options, so no new
-- field-type work is needed) and attaches a preset list of common
-- emotions to the existing before/during/after fields' options.choices
-- as suggestions. The emotion fields stay field_type 'tag' (free-form,
-- multi-value) rather than switching to 'dropdown' -- changing field_type
-- on a field with existing stored values is explicitly punted on lossy
-- conversion (see updateFieldDefinition in lib/fields/definitions.ts), so
-- this only adds suggested choices as metadata without touching the type
-- or any trade's stored values.
update field_definitions
set options = options || '{"choices": ["Calm", "Confident", "Fearful", "FOMO", "Excited", "Hesitant", "Stressed"]}'::jsonb
where key in ('emotion_before', 'emotion_during', 'emotion_after')
  and entity_type = 'trade';

insert into field_definitions (user_id, entity_type, key, label, field_type, options, sort_order, is_default)
select id, 'trade', 'emotion_intensity', 'Emotion Intensity', 'rating', '{"min": 1, "max": 10}'::jsonb, 113, true
from auth.users
on conflict (user_id, entity_type, key) do nothing;

create or replace function seed_default_field_definitions()
returns trigger as $$
begin
  insert into public.field_definitions (user_id, entity_type, key, label, field_type, options, sort_order, is_default)
  values
    (new.id, 'trade', 'strategy_setup', 'Strategy / Setup', 'tag', '{}'::jsonb, 90, true),
    (new.id, 'trade', 'notes_why_entered', 'Why did I take this trade?', 'large_notes', '{}'::jsonb, 100, true),
    (new.id, 'trade', 'notes_what_right', 'What did I do right?', 'large_notes', '{}'::jsonb, 101, true),
    (new.id, 'trade', 'notes_what_change', 'What would I change?', 'large_notes', '{}'::jsonb, 102, true),
    (new.id, 'trade', 'notes_lessons_learned', 'Lessons Learned', 'large_notes', '{}'::jsonb, 103, true),
    (new.id, 'trade', 'notes_additional', 'Additional Notes', 'large_notes', '{}'::jsonb, 104, true),
    (new.id, 'trade', 'emotion_before', 'Emotion Before Trade', 'tag', '{"choices": ["Calm", "Confident", "Fearful", "FOMO", "Excited", "Hesitant", "Stressed"]}'::jsonb, 110, true),
    (new.id, 'trade', 'emotion_during', 'Emotion During Trade', 'tag', '{"choices": ["Calm", "Confident", "Fearful", "FOMO", "Excited", "Hesitant", "Stressed"]}'::jsonb, 111, true),
    (new.id, 'trade', 'emotion_after', 'Emotion After Trade', 'tag', '{"choices": ["Calm", "Confident", "Fearful", "FOMO", "Excited", "Hesitant", "Stressed"]}'::jsonb, 112, true),
    (new.id, 'trade', 'emotion_intensity', 'Emotion Intensity', 'rating', '{"min": 1, "max": 10}'::jsonb, 113, true),
    (new.id, 'investment', 'average_cost', 'Average Cost', 'currency', '{}'::jsonb, 0, true),
    (new.id, 'investment', 'current_price', 'Current Price', 'currency', '{}'::jsonb, 1, true),
    (new.id, 'investment', 'total_shares', 'Total Shares', 'number', '{}'::jsonb, 2, true),
    (new.id, 'investment', 'total_value', 'Total Value', 'currency', '{}'::jsonb, 3, true),
    (new.id, 'investment', 'unrealized_gain_loss', 'Unrealized Gain/Loss', 'currency', '{}'::jsonb, 4, true),
    (new.id, 'investment', 'dividend_yield', 'Dividend Yield', 'percentage', '{}'::jsonb, 5, true),
    (new.id, 'investment', 'long_term_notes', 'Long-Term Notes', 'large_notes', '{}'::jsonb, 6, true);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- ===== 0008_trade_history.sql =====
-- Autosave version history: every time a trade row changes, the
-- pre-change row is snapshotted as jsonb. Implemented as an AFTER UPDATE
-- trigger rather than application-level snapshotting so every update
-- path (autosave debounce, duplicate, future bulk-edit features) is
-- covered automatically without each call site remembering to snapshot.
create table trade_history (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references trades(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create index trade_history_trade_idx on trade_history (trade_id, created_at desc);

alter table trade_history enable row level security;

create policy "trade_history owner access"
  on trade_history for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function snapshot_trade_history()
returns trigger as $$
begin
  insert into trade_history (trade_id, user_id, snapshot)
  values (old.id, old.user_id, to_jsonb(old));
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trades_snapshot_history
  before update on trades
  for each row
  execute function snapshot_trade_history();

-- ===== 0009_dashboard_layout.sql =====
-- Custom Layout: per-user dashboard widget order + size, persisted next
-- to the other per-user UI prefs (hidden_core_fields) rather than a new
-- table, since it's the same "one settings row per user" shape.
alter table user_settings
  add column dashboard_layout jsonb not null default '{}'::jsonb;

-- ===== 0010_trade_images.sql =====
create table trade_images (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references trades(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  created_at timestamptz default now()
);

alter table trade_images enable row level security;

create policy "trade_images owner access"
  on trade_images for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index trade_images_trade_id_idx on trade_images(trade_id);

-- ===== 0011_user_timezone.sql =====
-- Per-user IANA timezone, auto-detected client-side on first load and
-- used to bucket day-of-week insights (Ask Your Journal, Insights) in the
-- trader's local time instead of UTC. Null until the client sets it once;
-- callers should fall back to "UTC" when reading a null value.

alter table user_settings add column timezone text;

-- ===== 0012_trade_images_bucket.sql =====
-- Storage bucket + RLS policies for trade chart screenshots.
-- Path convention (see src/app/api/trades/[id]/images/route.ts): objects are
-- stored at "{user_id}/{trade_id}/{uuid}.{ext}", so (storage.foldername(name))[1]
-- is the owning user's id.
--
-- Best-effort migration inferred from application code; if the "trade-images"
-- bucket already exists in the live project with different policies, review
-- this against the live dashboard config before applying — the bucket insert
-- is idempotent (on conflict do nothing) so it won't clobber existing settings.

insert into storage.buckets (id, name, public)
values ('trade-images', 'trade-images', false)
on conflict (id) do nothing;

create policy "trade-images owner select"
  on storage.objects for select
  using (bucket_id = 'trade-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "trade-images owner insert"
  on storage.objects for insert
  with check (bucket_id = 'trade-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "trade-images owner update"
  on storage.objects for update
  using (bucket_id = 'trade-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "trade-images owner delete"
  on storage.objects for delete
  using (bucket_id = 'trade-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- ===== 0013_analytics.sql =====
-- Self-hosted usage analytics (total users, DAU/WAU/MAU, feature usage,
-- retention) so checking numbers never requires a Netlify redeploy -- the
-- admin dashboard at /admin/analytics queries this data live. See
-- D:\md files\claude7.md for the original brief.
--
-- is_admin lives on user_settings (this project's equivalent of a
-- "profiles" table -- 1:1 with auth.users, already auto-seeded on signup)
-- rather than a new table.

create table analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  session_id text not null,
  event_name text not null,        -- e.g. 'page_view', 'trade_created', 'session_start'
  event_props jsonb default '{}',  -- flexible metadata (page path, trade id, etc.)
  created_at timestamptz default now()
);

create index idx_analytics_user on analytics_events(user_id);
create index idx_analytics_event_name on analytics_events(event_name);
create index idx_analytics_created_at on analytics_events(created_at);

create table analytics_sessions (
  id text primary key,             -- session_id (uuid generated client-side per visit)
  user_id uuid references auth.users(id),
  started_at timestamptz default now(),
  last_seen_at timestamptz default now(),
  duration_seconds int default 0
);

alter table user_settings add column is_admin boolean not null default false;

-- Row Level Security -----------------------------------------------------
-- Regular users may only insert their own events/session rows, never read
-- any rows (their own or others'). Only admins (is_admin = true on their
-- own user_settings row) can read the raw tables; the admin dashboard
-- itself goes through the security-definer RPCs below instead, but the
-- select policy exists too as a defense-in-depth fallback.

alter table analytics_events enable row level security;

create policy "analytics_events insert own"
  on analytics_events for insert
  with check (auth.uid() = user_id);

create policy "analytics_events admin select"
  on analytics_events for select
  using (exists (select 1 from user_settings s where s.user_id = auth.uid() and s.is_admin));

alter table analytics_sessions enable row level security;

create policy "analytics_sessions insert own"
  on analytics_sessions for insert
  with check (auth.uid() = user_id);

-- Needed for the heartbeat upsert (last_seen_at / duration_seconds ticks).
create policy "analytics_sessions update own"
  on analytics_sessions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "analytics_sessions admin select"
  on analytics_sessions for select
  using (exists (select 1 from user_settings s where s.user_id = auth.uid() and s.is_admin));

-- Admin aggregate RPCs -----------------------------------------------------
-- auth.users isn't exposed through PostgREST/RLS, so these run as
-- security definer (same pattern as seed_user_settings() in
-- 0003_user_settings.sql) and each starts with its own admin check --
-- callers can't get real data out of them just by discovering the route,
-- since the page-level redirect in /admin/analytics is not the only gate.

create or replace function admin_overview_stats()
returns table (
  total_users bigint,
  signups_today bigint,
  dau bigint,
  wau bigint,
  mau bigint,
  avg_session_seconds_today numeric,
  median_session_seconds_today numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from user_settings where user_id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;

  return query
  select
    (select count(*) from auth.users),
    (select count(*) from auth.users where created_at >= date_trunc('day', now())),
    (select count(distinct user_id) from analytics_events where created_at >= now() - interval '1 day'),
    (select count(distinct user_id) from analytics_events where created_at >= now() - interval '7 days'),
    (select count(distinct user_id) from analytics_events where created_at >= now() - interval '30 days'),
    (select avg(duration_seconds) from analytics_sessions where started_at >= date_trunc('day', now())),
    (select percentile_cont(0.5) within group (order by duration_seconds)
       from analytics_sessions where started_at >= date_trunc('day', now()));
end;
$$;

create or replace function admin_usage_series(p_days int default 30)
returns table (day date, signups bigint, dau bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from user_settings where user_id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;

  return query
  with days as (
    select generate_series(current_date - (p_days - 1), current_date, interval '1 day')::date as day
  ),
  signups as (
    select created_at::date as day, count(*) as signups
    from auth.users
    group by 1
  ),
  active as (
    select created_at::date as day, count(distinct user_id) as dau
    from analytics_events
    group by 1
  )
  select d.day, coalesce(s.signups, 0), coalesce(a.dau, 0)
  from days d
  left join signups s on s.day = d.day
  left join active a on a.day = d.day
  order by d.day;
end;
$$;

create or replace function admin_feature_usage(p_days int default 30)
returns table (event_name text, count bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from user_settings where user_id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;

  return query
  select e.event_name, count(*) as count
  from analytics_events e
  where e.created_at >= now() - (p_days || ' days')::interval
    and e.event_name not in ('page_view', 'session_start')
  group by e.event_name
  order by count desc
  limit 20;
end;
$$;

create or replace function admin_retention_cohorts(p_weeks int default 8)
returns table (cohort_week date, cohort_size bigint, retained_next_week bigint, retention_pct numeric)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from user_settings where user_id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;

  return query
  with cohorts as (
    select id as user_id, date_trunc('week', created_at)::date as cohort_week
    from auth.users
    where created_at >= now() - (p_weeks || ' weeks')::interval
  ),
  active_weeks as (
    select distinct user_id, date_trunc('week', created_at)::date as active_week
    from analytics_events
  )
  select
    c.cohort_week,
    count(distinct c.user_id) as cohort_size,
    count(distinct case when aw.active_week = c.cohort_week + interval '7 day' then c.user_id end) as retained_next_week,
    round(
      count(distinct case when aw.active_week = c.cohort_week + interval '7 day' then c.user_id end)::numeric
      / nullif(count(distinct c.user_id), 0) * 100, 1
    ) as retention_pct
  from cohorts c
  left join active_weeks aw on aw.user_id = c.user_id
  group by c.cohort_week
  order by c.cohort_week;
end;
$$;

-- ===== 0014_analytics_grants.sql =====
-- Postgres grants EXECUTE on new functions to PUBLIC by default, but some
-- Supabase projects revoke that default as a hardening measure. If this
-- project does, the admin_* functions added in 0013_analytics.sql would
-- silently fail with a permission error the moment PostgREST calls them as
-- the `authenticated` role, even though everything else in that migration
-- (table inserts, which use a separate privilege system already open on
-- this project) works fine. Grant explicitly so it works regardless.

grant execute on function admin_overview_stats() to authenticated;
grant execute on function admin_usage_series(int) to authenticated;
grant execute on function admin_feature_usage(int) to authenticated;
grant execute on function admin_retention_cohorts(int) to authenticated;

-- ===== 0015_fix_overview_stats.sql =====
-- admin_overview_stats() failed at runtime with:
--   ERROR: structure of query does not match function result type
--   DETAIL: Returned type double precision does not match expected type
--   numeric in column 7.
-- percentile_cont() returns double precision, but the function declares
-- median_session_seconds_today as numeric -- RETURN QUERY requires an
-- exact type match (unlike a plain SELECT, it won't implicitly cast).
-- Explicitly cast the percentile_cont result to numeric to fix.

create or replace function admin_overview_stats()
returns table (
  total_users bigint,
  signups_today bigint,
  dau bigint,
  wau bigint,
  mau bigint,
  avg_session_seconds_today numeric,
  median_session_seconds_today numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from user_settings where user_id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;

  return query
  select
    (select count(*) from auth.users),
    (select count(*) from auth.users where created_at >= date_trunc('day', now())),
    (select count(distinct user_id) from analytics_events where created_at >= now() - interval '1 day'),
    (select count(distinct user_id) from analytics_events where created_at >= now() - interval '7 days'),
    (select count(distinct user_id) from analytics_events where created_at >= now() - interval '30 days'),
    (select avg(duration_seconds) from analytics_sessions where started_at >= date_trunc('day', now())),
    (select (percentile_cont(0.5) within group (order by duration_seconds))::numeric
       from analytics_sessions where started_at >= date_trunc('day', now()));
end;
$$;

grant execute on function admin_overview_stats() to authenticated;

-- ===== 0016_account_transactions.sql =====
-- Account cash ledger: each row is a manual deposit (positive amount) or
-- withdrawal (negative amount). Current cash is never stored -- it's always
-- derived as sum(account_transactions.amount) + sum(trades.dollar_pl), so
-- editing or deleting a trade can never leave a stale balance behind.

create table account_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric not null,
  note text,
  created_at timestamptz not null default now()
);

create index account_transactions_user_created_idx
  on account_transactions (user_id, created_at desc);

alter table account_transactions enable row level security;

create policy "account_transactions owner access"
  on account_transactions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ===== 0017_strategies.sql =====
-- Strategies as first-class, manageable entities (replacing the old
-- free-text "Strategy / Setup" tag, which just lived as retyped strings
-- in custom_fields.strategy_setup with no canonical list and no way to
-- rename a strategy retroactively across past trades).
--
-- A trade can use more than one strategy at once (kept from the old tag
-- behavior), hence the join table rather than a single strategy_id
-- column on trades.

create table strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  color text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create trigger strategies_set_updated_at
  before update on strategies
  for each row
  execute function set_updated_at();

create table trade_strategies (
  trade_id uuid not null references trades(id) on delete cascade,
  strategy_id uuid not null references strategies(id) on delete cascade,
  primary key (trade_id, strategy_id)
);

create index trade_strategies_strategy_idx on trade_strategies (strategy_id);

alter table strategies enable row level security;
alter table trade_strategies enable row level security;

create policy "strategies owner access"
  on strategies for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "trade_strategies owner access"
  on trade_strategies for all
  using (exists (select 1 from strategies s where s.id = strategy_id and s.user_id = auth.uid()))
  with check (exists (select 1 from strategies s where s.id = strategy_id and s.user_id = auth.uid()));

-- Custom fields scoped to one strategy (e.g. "Volume confirmation" only
-- makes sense for a "Breakout" strategy). null strategy_id keeps today's
-- behavior -- a field global to the entity type. The original
-- (user_id, entity_type, key) unique constraint is replaced with two
-- partial indexes because a plain unique index would let every
-- strategy_id-null row collide on nothing -- Postgres treats each NULL as
-- distinct, which is correct for the *strategy-scoped* half (two
-- different strategies re-using the same key must be allowed) but wrong
-- for the *global* half (those still need one key to mean one field).
alter table field_definitions
  add column strategy_id uuid references strategies(id) on delete cascade;

alter table field_definitions
  drop constraint field_definitions_user_id_entity_type_key_key;

create unique index field_definitions_global_key_idx
  on field_definitions (user_id, entity_type, key)
  where strategy_id is null;

create unique index field_definitions_strategy_key_idx
  on field_definitions (user_id, entity_type, strategy_id, key)
  where strategy_id is not null;

-- Values for strategy-scoped custom fields, namespaced by strategy_id:
-- { "<strategy_id>": { "<field_key>": value, ... }, ... }. A separate
-- column (rather than folding into custom_fields) because a trade
-- carrying multiple strategies could otherwise collide if two of them
-- define a field with the same key.
alter table trades
  add column strategy_field_values jsonb not null default '{}'::jsonb;

alter table user_settings
  add column has_completed_tour boolean not null default false;

-- One-time backfill: turn each user's existing free-text strategy_setup
-- tag values into real strategy rows + trade_strategies links. Left
-- as plain SQL (not a function) since it only ever needs to run once,
-- driven by data that already exists at migration time.
with tag_values as (
  select
    t.user_id,
    t.id as trade_id,
    tag as name
  from trades t
  cross join lateral jsonb_array_elements_text(
    -- Guard the array shape *before* calling the set-returning function --
    -- a WHERE clause on jsonb_typeof would filter rows too late, since
    -- jsonb_array_elements_text errors immediately on non-array input
    -- (missing key, string, object, etc.) rather than being skipped by it.
    case
      when jsonb_typeof(t.custom_fields->'strategy_setup') = 'array'
      then t.custom_fields->'strategy_setup'
      else '[]'::jsonb
    end
  ) as tag
  where trim(tag) <> ''
),
inserted_strategies as (
  insert into strategies (user_id, name)
  select distinct user_id, trim(name)
  from tag_values
  on conflict (user_id, name) do nothing
  returning id, user_id, name
),
all_strategies as (
  select id, user_id, name from inserted_strategies
  union
  select s.id, s.user_id, s.name
  from strategies s
  join (select distinct user_id, trim(name) as name from tag_values) tv
    on tv.user_id = s.user_id and tv.name = s.name
)
insert into trade_strategies (trade_id, strategy_id)
select distinct tv.trade_id, s.id
from tag_values tv
join all_strategies s on s.user_id = tv.user_id and s.name = trim(tv.name)
on conflict do nothing;

-- ===== 0018_retire_strategy_setup_field.sql =====
-- The free-text "Strategy / Setup" tag field (custom_fields.strategy_setup)
-- is superseded by real strategies (migration 0017) -- keeping it around
-- would show a redundant, disconnected tag input right next to the new
-- strategy picker on every trade. Existing trades keep the raw value
-- under custom_fields forever (same guarantee as any other removed
-- field); this only removes the field_definition row so it stops
-- rendering on the form and in the Fields page's Custom Fields list.
delete from field_definitions
where key = 'strategy_setup'
  and entity_type = 'trade'
  and strategy_id is null;

create or replace function seed_default_field_definitions()
returns trigger as $$
begin
  insert into public.field_definitions (user_id, entity_type, key, label, field_type, options, sort_order, is_default)
  values
    (new.id, 'trade', 'notes_why_entered', 'Why did I take this trade?', 'large_notes', '{}'::jsonb, 100, true),
    (new.id, 'trade', 'notes_what_right', 'What did I do right?', 'large_notes', '{}'::jsonb, 101, true),
    (new.id, 'trade', 'notes_what_change', 'What would I change?', 'large_notes', '{}'::jsonb, 102, true),
    (new.id, 'trade', 'notes_lessons_learned', 'Lessons Learned', 'large_notes', '{}'::jsonb, 103, true),
    (new.id, 'trade', 'notes_additional', 'Additional Notes', 'large_notes', '{}'::jsonb, 104, true),
    (new.id, 'trade', 'emotion_before', 'Emotion Before Trade', 'tag', '{"choices": ["Calm", "Confident", "Fearful", "FOMO", "Excited", "Hesitant", "Stressed"]}'::jsonb, 110, true),
    (new.id, 'trade', 'emotion_during', 'Emotion During Trade', 'tag', '{"choices": ["Calm", "Confident", "Fearful", "FOMO", "Excited", "Hesitant", "Stressed"]}'::jsonb, 111, true),
    (new.id, 'trade', 'emotion_after', 'Emotion After Trade', 'tag', '{"choices": ["Calm", "Confident", "Fearful", "FOMO", "Excited", "Hesitant", "Stressed"]}'::jsonb, 112, true),
    (new.id, 'trade', 'emotion_intensity', 'Emotion Intensity', 'rating', '{"min": 1, "max": 10}'::jsonb, 113, true),
    (new.id, 'investment', 'average_cost', 'Average Cost', 'currency', '{}'::jsonb, 0, true),
    (new.id, 'investment', 'current_price', 'Current Price', 'currency', '{}'::jsonb, 1, true),
    (new.id, 'investment', 'total_shares', 'Total Shares', 'number', '{}'::jsonb, 2, true),
    (new.id, 'investment', 'total_value', 'Total Value', 'currency', '{}'::jsonb, 3, true),
    (new.id, 'investment', 'unrealized_gain_loss', 'Unrealized Gain/Loss', 'currency', '{}'::jsonb, 4, true),
    (new.id, 'investment', 'dividend_yield', 'Dividend Yield', 'percentage', '{}'::jsonb, 5, true),
    (new.id, 'investment', 'long_term_notes', 'Long-Term Notes', 'large_notes', '{}'::jsonb, 6, true);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- ===== 0019_analytics_cascade_delete.sql =====
-- analytics_events/analytics_sessions.user_id were created without "on
-- delete cascade" (0013_analytics.sql), unlike every other user-owned
-- table in this app. That's fine until account deletion: auth.admin
-- deleteUser() would hit a foreign-key violation on any account with
-- analytics history (i.e. almost every real account), since Postgres
-- defaults to NO ACTION. Align these with the rest of the schema so
-- deleting a user cascades their analytics rows too.

alter table analytics_events drop constraint analytics_events_user_id_fkey;
alter table analytics_events add constraint analytics_events_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table analytics_sessions drop constraint analytics_sessions_user_id_fkey;
alter table analytics_sessions add constraint analytics_sessions_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

-- ===== 0020_dashboard_stats_rpc.sql =====
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

-- ===== 0021_dashboard_stats_investment_committed_cash.sql =====
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

-- ===== 0022_commissions.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role key in this project, so
-- migrations are never applied automatically -- see supabase/migrations/*.sql
-- for the existing convention.
--
-- Broker commissions. Real brokers charge a fee on entry AND on exit, which
-- means a trade's true break-even price sits *past* its entry price: buy 1
-- share at $90 with a $2.50-per-side fee and the price has to reach $95
-- before the position is actually profitable. Until now this app computed
-- P&L purely from price movement, overstating every result.
--
-- Rules live in their own table (rather than a jsonb blob on user_settings)
-- because they're a repeating, individually-editable, orderable, per-user
-- entity that's matched against each trade -- the same shape as `strategies`
-- in 0017, and for the same reasons.

create type commission_rule_type as enum ('flat', 'percent', 'per_unit');
create type commission_side as enum ('both', 'entry', 'exit');

create table commission_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,

  -- flat     -> `amount` is dollars charged per side, regardless of size
  -- percent  -> `amount` is a percent (2.5 = 2.5%) of that side's notional
  --             (price * shares)
  -- per_unit -> `amount` is dollars per share/contract
  rule_type commission_rule_type not null,
  amount numeric not null default 0,

  -- Which side(s) of the round trip this rule bills. 'both' is the common
  -- case (most brokers charge to open *and* to close); 'exit' covers the
  -- venues that only bill on the closing fill.
  applies_to commission_side not null default 'both',

  -- Optional scoping: null means "any". Matched case-insensitively against
  -- trades.asset_type / trades.market so one account can charge a flat fee
  -- on stocks and a percentage on crypto.
  asset_type text,
  market text,

  -- Optional per-side floor/cap, e.g. "0.1% but never less than $1.00".
  min_fee numeric,
  max_fee numeric,

  enabled boolean not null default true,
  -- First enabled rule that matches a trade wins, ordered by sort_order --
  -- so a specific "crypto" rule can be placed above a catch-all.
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index commission_rules_user_order_idx on commission_rules (user_id, sort_order);

create trigger commission_rules_set_updated_at
  before update on commission_rules
  for each row
  execute function set_updated_at();

alter table commission_rules enable row level security;

create policy "commission_rules owner access"
  on commission_rules for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Total fees attributed to this trade: the entry-side fee once it's open,
-- plus the exit-side fee once it's closed. Stored as a real column (not
-- derived at read time) because trades.dollar_pl is stored *net* of it --
-- see src/lib/trades/compute.ts. Keeping dollar_pl net is what lets every
-- existing aggregate (dashboard, analytics, insights, ask, account balance,
-- and the dashboard_stats RPC in 0020/0021) stay correct without change:
-- they all sum dollar_pl, and the number they sum is now what actually hit
-- the account.
alter table trades add column commission numeric;

-- True when the user typed a commission on the trade by hand, which pins it
-- against the automatic per-rule recalculation. Without this flag, editing
-- any other field on the trade would silently overwrite the manual value.
alter table trades add column commission_manual boolean not null default false;

-- ===== 0023_trade_history_retention.sql =====
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

-- ===== 0024_user_settings_column_grants.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
--
-- PRIVILEGE ESCALATION FIX.
--
-- `is_admin` (added in 0013_analytics.sql) lives on user_settings, whose only
-- policy is "user_settings owner access" (0003): `for all using (auth.uid() =
-- user_id)`. That controls which *rows* a user may write -- Postgres RLS has
-- no way to express which *columns* they may write. So the policy happily
-- allowed a user to update their own row's is_admin to true.
--
-- The anon key is public by design (NEXT_PUBLIC_SUPABASE_ANON_KEY, shipped to
-- the browser in src/lib/supabase/client.ts), so this was exploitable from
-- devtools in one line:
--
--   supabase.from("user_settings").update({ is_admin: true }).eq("user_id", myId)
--
-- and is_admin gates: select on analytics_events / analytics_sessions (every
-- user's raw rows, per 0013's "admin select" policies) and all four
-- admin_* security-definer RPCs (platform-wide counts over auth.users).
--
-- Column-level GRANTs are the only mechanism that constrains this. RLS still
-- applies on top -- this adds the dimension RLS can't cover.

-- INSERT is granted too, not just UPDATE: setTourCompleted,
-- setDashboardLayout and setCoreFieldHidden (src/lib/settings/queries.ts) all
-- use upsert, which needs INSERT privilege on every column it names. Omitting
-- these would break saving settings entirely.
revoke insert, update on user_settings from authenticated;

grant insert (user_id, hidden_core_fields, timezone, dashboard_layout, has_completed_tour)
  on user_settings to authenticated;

grant update (hidden_core_fields, timezone, dashboard_layout, has_completed_tour)
  on user_settings to authenticated;

-- `select` is deliberately left alone: reading is_admin is what the app's own
-- isAdmin() check does. Only writing it is the problem. From here, is_admin is
-- settable only with the service-role key (i.e. from the Supabase dashboard).

-- Defense in depth: the join-table policies checked only one side ------------
-- Both policies verified you own the folder/strategy but never that you own
-- the *trade*, so a link row could be inserted pointing at someone else's
-- trade_id. Not exploitable for reading data (trades' own RLS still blocks the
-- row, and trade_id is an unguessable uuid), but the check belongs on both
-- sides of a join table.

drop policy if exists "trade_folders owner access" on trade_folders;
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

drop policy if exists "trade_strategies owner access" on trade_strategies;
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

-- ===== 0025_realized_pl_requires_closed.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it (0021 must already be applied -- this replaces the same function).
--
-- dashboard_stats' account_stats CTE summed dollar_pl from every trade where
-- it was non-null, with no status filter. dollar_pl only needs an entry
-- price, an exit price, and a share count to compute -- none of which
-- require the trade to actually be closed. Typing a hypothetical exit price
-- to preview a number, without flipping status to closed, made that preview
-- count as cash that had actually landed: it inflated balance and
-- availableCash, which position-size prefill (POST /api/trades) then spends.
--
-- Fixed in JS too (account/queries.ts's getAccountBalance -- the JS fallback
-- this RPC exists to avoid on the hot path) and mirrored here so both agree.
-- Only the account_stats CTE changes; everything else is identical to 0021.

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
        -- CHANGED (0025): added `status = 'closed'` -- see header comment.
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

-- ===== 0026_setup_tie_shows_no_worst.sql =====
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

-- ===== 0027_committed_cash_includes_pending.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it (0026 must already be applied -- this replaces the same function).
--
-- account_stats' v_committed_cash only summed trades with status = 'open',
-- but a pending limit/stop order already has its position_size set aside
-- for it (see scripts/seed-fake-data.mjs, which seeds pending trades with a
-- position_size the same as open ones) -- that money is reserved the moment
-- the order is placed, not just once it fills. Excluding pending orders
-- here made committed_cash (and therefore availableCash, and the new-trade
-- position-size prefill that spends it) overstate what's actually free by
-- whatever was sitting in pending orders.
--
-- Fixed in JS too (account/queries.ts's getAccountBalance) and mirrored
-- here so both agree. Only the v_committed_cash subquery's status filter
-- changes; everything else is identical to 0026.

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

grant execute on function dashboard_stats(timestamptz, timestamptz, timestamptz, timestamptz, text) to authenticated;

-- ===== 0028_trade_folders_strategies_ownership.sql =====
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

-- ===== 0029_ai_keys_and_plan.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically -- see
-- supabase/migrations/*.sql for the existing convention.
--
-- Paid "Ask Your Journal" (bring-your-own-key AI). Two independent pieces:
--   1. a minimal free/paid plan flag, which nothing in the app has had until
--      now (no Stripe, no subscriptions table -- see below);
--   2. per-user AI provider API keys, stored encrypted at rest.

-- 1. PLAN FLAG ---------------------------------------------------------------
--
-- Deliberately a plain column on user_settings rather than a subscriptions
-- table: there is no billing system yet, nothing writes this automatically,
-- and a single row per user with one of two values doesn't need its own
-- entity. If real billing ever lands (renewal dates, payment state, plan
-- history), that's the point to promote this to its own table -- not now.
alter table user_settings
  add column plan text not null default 'free' check (plan in ('free', 'paid'));

-- NO GRANT FOR `plan` -- THIS OMISSION IS THE SECURITY CONTROL.
--
-- 0024_user_settings_column_grants.sql fixed a privilege escalation on this
-- exact table: `is_admin` sat on user_settings, whose only policy is
-- "user_settings owner access" (0003) -- `for all using (auth.uid() =
-- user_id)`. RLS constrains which *rows* a user may write and has no way to
-- express which *columns*, so the policy happily allowed a user to set their
-- own row's is_admin to true. The anon key is public by design (shipped to
-- the browser in src/lib/supabase/client.ts), making it a one-liner from
-- devtools.
--
-- `plan` is the same shape of column and would be the same bug:
--
--   supabase.from("user_settings").update({ plan: 'paid' }).eq("user_id", myId)
--
-- 0024 already revoked the table-level insert/update from `authenticated` and
-- re-granted a specific column list, and column-level grants cover only the
-- columns they name -- so a newly added column starts with no write privilege
-- and this is safe *by default*. That default is load-bearing, not incidental:
-- do not add `plan` to those grant lists, and do not restore a table-wide
-- `grant update on user_settings`. From here, plan is settable only with the
-- service-role key -- i.e. from the Supabase dashboard, or the admin-gated
-- route that uses createAdminClient() (src/lib/supabase/admin.ts).
--
-- `select` is intentionally untouched, matching 0024's treatment of is_admin:
-- the app must read plan on every page that gates on it (getUserSettings in
-- src/lib/settings/queries.ts). Reading it was never the problem.

-- 2. USER API KEYS -----------------------------------------------------------
--
-- One row per provider key the user has added. Multiple rows per user is the
-- intended shape, not an accident -- a user may hold an OpenAI and an
-- Anthropic key at once and pick between them per question, so there is
-- deliberately no unique constraint on (user_id, provider).
create table user_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  provider text not null check (provider in ('openai', 'anthropic', 'google')),

  -- Optional user-supplied nickname, e.g. "personal" vs "work billing acct",
  -- so the key picker is meaningful when several keys share a provider.
  label text,

  -- AES-256-GCM ciphertext produced by src/lib/ai-keys/crypto.ts, keyed by the
  -- server-only AI_KEY_ENCRYPTION_SECRET env var. The plaintext key never
  -- touches this column and is never returned to the client after creation --
  -- it is decrypted server-side only, inside the route about to call the
  -- provider. A database dump alone therefore does not leak usable keys.
  encrypted_key text not null,

  -- Last 4 characters of the *plaintext* key, kept separately so the UI can
  -- render "•••• 4a2f" without decrypting anything. 4 characters of a 40+
  -- character secret is not enough to narrow a brute force meaningfully, and
  -- it is what lets a user tell two keys apart when both are masked.
  last_four text not null,

  -- Soft-disable without deleting, so a user can park a key (e.g. while its
  -- billing is sorted out) instead of re-pasting it later. The ask route only
  -- ever selects active keys.
  is_active boolean not null default true,

  -- When the key last passed a live provider check. Set on create (keys are
  -- test-called before they are ever saved) so a saved key is known-good at
  -- least once -- a silently-saved bad key produces a confusing failure at
  -- question time instead of an actionable one at setup time.
  last_validated_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Both read paths filter by user_id and all but the management list also
-- filter is_active, so the composite covers each without a second index.
create index user_api_keys_user_active_idx on user_api_keys (user_id, is_active);

create trigger user_api_keys_set_updated_at
  before update on user_api_keys
  for each row
  execute function set_updated_at();

alter table user_api_keys enable row level security;

create policy "user_api_keys owner access"
  on user_api_keys for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ===== 0030_more_ai_providers.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically -- see
-- supabase/migrations/*.sql for the existing convention.
--
-- Adds three more AI providers, all with a usable free tier: Groq,
-- OpenRouter and Cerebras. 0029 pinned `provider` to a three-value check
-- constraint, so without this the API would reject them with a constraint
-- violation before any key could be stored.
--
-- All three speak the OpenAI-compatible /chat/completions API, so they share
-- one adapter in src/lib/ai-keys/providers/openai-compatible.ts rather than
-- getting an integration each. This constraint is the database's half of the
-- same list -- it must stay in sync with AI_PROVIDERS in
-- src/lib/ai-keys/types.ts and the zod enum built from it.

-- The constraint name is the one Postgres generates for an inline column
-- check on this table. `if exists` keeps this migration safe to re-run and
-- tolerant of a differently-named constraint, which would then need dropping
-- by hand -- check with:
--   select conname from pg_constraint where conrelid = 'user_api_keys'::regclass;
alter table user_api_keys
  drop constraint if exists user_api_keys_provider_check;

alter table user_api_keys
  add constraint user_api_keys_provider_check
  check (provider in ('openai', 'anthropic', 'google', 'groq', 'openrouter', 'cerebras'));

-- ===== 0031_ai_provider_consent.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically -- see
-- supabase/migrations/*.sql for the existing convention.
--
-- Records that a user agreed to send their journal to a specific AI provider.
--
-- Replaces a browser-local flag. Two things were wrong with that:
--
--   1. It was keyed by user only, so agreeing to send data to Groq also
--      silently covered a later switch to OpenAI or Google -- providers the
--      user had never been shown, under terms they had never seen. Consent to
--      disclose personal data to one third party is not consent to disclose
--      it to a different one, so the grain has to be per provider.
--
--   2. It lived in localStorage, which means it was per browser rather than
--      per person (a second device asks again), it vanished when site data was
--      cleared, and the app itself held no record that anyone had ever agreed
--      -- exactly the record you want to be able to produce later.
--
-- One row per (user, provider). The row's existence IS the consent; there is
-- deliberately no boolean to get out of sync with it. Withdrawing consent
-- deletes the row, which makes "never agreed" and "changed their mind"
-- identical states -- correct here, because both mean "ask again before
-- sending anything".

create table ai_provider_consents (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Same six values as user_api_keys.provider (0030). Not a foreign key to
  -- anything: consent is about the *provider*, and it must survive the user
  -- deleting and re-adding a key for that provider.
  provider text not null check (provider in ('openai', 'anthropic', 'google', 'groq', 'openrouter', 'cerebras')),

  -- When they agreed. Kept rather than a bare boolean so the record can answer
  -- "when did this happen", which a boolean never can.
  accepted_at timestamptz not null default now(),

  primary key (user_id, provider)
);

alter table ai_provider_consents enable row level security;

create policy "ai_provider_consents owner access"
  on ai_provider_consents for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ===== 0032_ai_reviews.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically -- see
-- supabase/migrations/*.sql for the existing convention.
--
-- Generated AI reviews: the paid "AI Trade Review" feature, and the period
-- (weekly / monthly / custom) reviews built on the same foundation.
--
-- ONE TABLE FOR BOTH, because they are the same record with a different
-- scope: some model, on the user's own key, produced a structured critique of
-- some set of trades at some point in time. Two tables would duplicate the
-- provider/model/staleness columns and then need two readers, two delete
-- routes and two retention rules for no gain.
--
-- Reviews are STORED rather than recomputed on every view. The generation
-- spends the user's own provider quota, so re-deriving one to render a page
-- the user already paid to produce would be the app quietly spending their
-- money. It also means a review stays readable when the key that produced it
-- is later revoked.

create table ai_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  review_type text not null check (review_type in ('trade', 'weekly', 'monthly', 'custom')),

  -- Set for a single-trade review, null for a period one. `on delete cascade`
  -- because a review of a deleted trade is unreadable: every figure in it
  -- refers to a row that no longer exists.
  trade_id uuid references trades(id) on delete cascade,

  -- Local calendar days (resolved in the user's timezone before insert), not
  -- timestamps. The period a review covers is a human-facing range -- "week of
  -- 25 Aug" -- and storing instants would re-open the UTC-vs-local bug that
  -- 0020-era analytics fixes and src/lib/dates/local-day.ts exist to prevent.
  period_start date,
  period_end date,

  -- Scope and type must agree. Without this a row can claim to be a trade
  -- review while carrying a date range, or a weekly review with no range at
  -- all -- shapes no reader knows how to render, and which only ever appear
  -- long after the bug that wrote them.
  constraint ai_reviews_scope_matches_type check (
    (review_type = 'trade'
      and trade_id is not null
      and period_start is null
      and period_end is null)
    or
    (review_type <> 'trade'
      and trade_id is null
      and period_start is not null
      and period_end is not null
      and period_end >= period_start)
  ),

  -- How many positions the review actually covered. Shown to the user
  -- ("24 trades analysed") and used to detect that the period has since
  -- gained or lost trades.
  trades_analyzed integer not null check (trades_analyzed >= 0),

  -- Which provider and model produced this. Recorded because the answer is
  -- only interpretable alongside the thing that wrote it: a review from a
  -- 8B free-tier model and one from a frontier model are not the same
  -- artifact, and the user swaps between them freely. Same six values as
  -- user_api_keys.provider (0030); NOT a foreign key to user_api_keys, so a
  -- review survives the user deleting the key that generated it.
  provider text not null check (provider in ('openai', 'anthropic', 'google', 'groq', 'openrouter', 'cerebras')),
  model text not null,

  -- The validated structured review (see src/lib/ai-reviews/schema.ts).
  -- jsonb rather than text: the app renders it section by section into fixed
  -- components, so it is read as structure, never as prose.
  --
  -- Written only by the server, after zod validation. RLS below still lets a
  -- user insert into their OWN row -- as it does for trades and every other
  -- table here -- which means a determined user could fabricate a review of
  -- their own journal. That is deliberately not defended against: it is their
  -- own data, visible only to them, and the alternative (revoking insert and
  -- routing through the service-role key) would trade a real security
  -- boundary for a cosmetic one.
  content jsonb not null,

  -- STALENESS (§13): the newest `updated_at` across the trades this review
  -- analysed. A trade edited after generation moves its own updated_at past
  -- this value, which is what lets the UI say "generated before 3 trades were
  -- edited" instead of silently showing a critique of numbers that changed.
  --
  -- Derived from data the app already maintains -- `trades` has had an
  -- updated_at trigger since 0001 -- so this costs no new column on trades
  -- and no write path anywhere else.
  source_updated_at timestamptz,

  created_at timestamptz not null default now()
);

-- One review per trade: regenerating REPLACES rather than accumulating.
--
-- Trade reviews deliberately keep no history: a superseded critique of a
-- trade that has since been corrected is not a record anyone wants, and one
-- row per trade bounds the table by the size of the journal. Period reviews
-- DO keep history -- comparing this week's review with last week's is the
-- point of having them, and they are unaffected here because Postgres treats
-- nulls as distinct in a unique constraint: every period review carries a
-- null trade_id and so never conflicts with another.
--
-- Deliberately a CONSTRAINT rather than a partial unique index, even though a
-- partial index (`where trade_id is not null`) would be marginally smaller.
-- `insert ... on conflict (user_id, trade_id)` -- which is how regeneration
-- replaces a review in one statement -- can only infer a partial index if the
-- statement repeats the index's WHERE predicate, and PostgREST's upsert emits
-- only the column list. Against a partial index the upsert would therefore
-- fail at runtime with "no unique or exclusion constraint matching the ON
-- CONFLICT specification", every time, on a path that looks correct here.
alter table ai_reviews
  add constraint ai_reviews_one_per_trade unique (user_id, trade_id);

-- Covers the period-history list (newest first, filtered by type) and, via
-- its leading column, any "all my reviews" read.
create index ai_reviews_user_period_idx
  on ai_reviews (user_id, review_type, period_start desc);

alter table ai_reviews enable row level security;

create policy "ai_reviews owner access"
  on ai_reviews for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ===== 0033_strategy_rules.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically -- see
-- supabase/migrations/*.sql for the existing convention.
--
-- Trading plan rules: measurable, user-defined conditions attached to a
-- strategy, which trades are then scored against.
--
-- WHY THIS EXISTS. A trader could already write "risk 1%, target 2R, enter on
-- volume" into strategies.description (0017) -- free text nobody can measure,
-- and which the AI trade review has to *interpret* rather than check. This
-- turns that paragraph into rows a pure function can evaluate, so "did I
-- follow my plan?" becomes a fact computed from stored data rather than a
-- model's reading of prose.
--
-- RULES HANG OFF STRATEGIES, not off trades. A rule is part of a plan, and a
-- trade is already linked to its strategies through trade_strategies (0017),
-- so a trade inherits the rules of whichever strategies it was tagged with.
-- That also means editing a rule immediately changes what every past trade is
-- scored against, which is correct: the rule is the current definition of the
-- plan, and there is no version of "what my plan used to say" that the app
-- could honestly reconstruct.
--
-- NOTHING IS STORED PER TRADE. Evaluation results are computed on read, never
-- persisted. Storing them would create a second source of truth that goes
-- stale the moment a trade is edited -- and this app's rule is that every
-- displayed metric must be reproducible from stored data. Recomputing is
-- cheap: it is arithmetic over rows already fetched to render the page.

create table strategy_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Deleting a strategy takes its rules with it. A rule with no plan to
  -- belong to has nothing to be evaluated against.
  strategy_id uuid not null references strategies(id) on delete cascade,

  -- What the trader calls this rule, shown verbatim in the adherence list.
  -- Free text on purpose: "Risk <= 1%" and "Never size up after a loss" are
  -- both legitimate names, and the machine-readable part lives in the columns
  -- below rather than being parsed back out of this.
  label text not null,

  -- WHERE the value being tested comes from:
  --   core    -- a column on `trades` (risk_percent, r_multiple, ...)
  --   derived -- computed from other stored data (holding_days, stop_moved)
  --   custom  -- a field_definitions key, read from trades.custom_fields or
  --              trades.strategy_field_values
  -- Kept as three explicit sources rather than one namespaced string so a
  -- custom field whose key happens to collide with a column name can never be
  -- silently read from the wrong place.
  subject_source text not null check (subject_source in ('core', 'derived', 'custom')),
  subject_key text not null,

  -- The comparison. Deliberately a fixed vocabulary rather than a free-text
  -- expression: an expression language would need a parser, a sandbox, and a
  -- story for what a malformed expression does to a page full of trades --
  -- for rules that are, in practice, always "this number vs that number".
  operator text not null check (
    operator in (
      'lte', 'lt', 'gte', 'gt', 'eq', 'neq', 'between',
      'is_set', 'is_not_set',
      'is_true', 'is_false',
      'text_eq', 'text_neq', 'contains'
    )
  ),

  -- Operands. Which one is used depends on the operator; all are nullable
  -- because most operators use none or one of them. Validated in
  -- src/lib/plan-rules/schema.ts, which is where the operator-to-operand
  -- pairing is enforced -- a check constraint covering every combination
  -- would be long, hard to read, and would duplicate that logic in a second
  -- place that could disagree with it.
  number_value numeric,
  number_value_max numeric,
  text_value text,

  -- Switched off without deleting, so a trader can suspend a rule they are
  -- deliberately relaxing this month without losing its definition.
  enabled boolean not null default true,

  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every read is "the rules for this strategy, in order".
create index strategy_rules_strategy_idx on strategy_rules (strategy_id, sort_order);

create trigger strategy_rules_set_updated_at
  before update on strategy_rules
  for each row
  execute function set_updated_at();

alter table strategy_rules enable row level security;

create policy "strategy_rules owner access"
  on strategy_rules for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ===== 0034_trade_mistakes_field.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically -- see
-- supabase/migrations/*.sql for the existing convention.
--
-- A default "Mistakes" field, for the mistake / violation tracker.
--
-- WHY A FIELD RATHER THAN A TABLE. Most of the tracker needs no schema at all:
-- it derives moved stops, early exits and oversizing from data already stored,
-- and reads broken plan rules from strategy_rules (0033). What it cannot
-- derive is the mistake only the trader knows they made -- revenge trading,
-- FOMO, taking a setup they had decided to skip. That is a per-trade list of
-- user-chosen labels, which is precisely what the `tag` field type already is,
-- and what the emotion fields have used since 0002.
--
-- Building a `mistakes` table instead would mean a second tagging system with
-- its own editor, its own RLS and its own join, sitting next to a field engine
-- that already does exactly this -- and it would not appear on the trade form
-- without further work, because the form renders field_definitions.
--
-- The `choices` are SUGGESTIONS, not a fixed vocabulary: `tag` fields are
-- free-form, so a trader can record a mistake nobody anticipated. The presets
-- exist so the field is usable on day one rather than being an empty box.

insert into field_definitions (user_id, entity_type, key, label, field_type, options, sort_order, is_default)
select
  id,
  'trade',
  'trade_mistakes',
  'Mistakes',
  'tag',
  '{"choices": ["Moved stop", "Chased entry", "Oversized", "Exited too early", "Let loser run", "Broke strategy rules", "Revenge trade", "FOMO", "No plan"]}'::jsonb,
  120,
  true
from auth.users
-- Idempotent: re-running this must not fail, and must not disturb a user who
-- has already renamed the field or edited its suggestions.
--
-- THE `where` CLAUSE IS REQUIRED, and its absence is why an earlier draft of
-- this migration failed with "no unique or exclusion constraint matching the
-- ON CONFLICT specification". 0001 created a plain
-- `unique (user_id, entity_type, key)` constraint, but 0017 DROPPED it and
-- replaced it with two PARTIAL unique indexes -- one for global fields
-- (`where strategy_id is null`) and one for strategy-scoped ones. Postgres can
-- only infer a partial index if the statement repeats the index's own
-- predicate, so the bare column list that worked in 0007 (written before 0017)
-- matches nothing here.
--
-- `strategy_id` is not set by the insert above, so it defaults to null and the
-- row belongs to the global index this predicate names.
on conflict (user_id, entity_type, key) where strategy_id is null do nothing;

-- Same list for new users. This function is REPLACED wholesale on every
-- change, so the body below is 0018's definition -- the current one -- plus
-- the row above. Anything dropped here would silently stop being seeded for
-- every account created afterwards, which is why it is reproduced in full
-- rather than patched.
create or replace function seed_default_field_definitions()
returns trigger as $$
begin
  insert into public.field_definitions (user_id, entity_type, key, label, field_type, options, sort_order, is_default)
  values
    (new.id, 'trade', 'notes_why_entered', 'Why did I take this trade?', 'large_notes', '{}'::jsonb, 100, true),
    (new.id, 'trade', 'notes_what_right', 'What did I do right?', 'large_notes', '{}'::jsonb, 101, true),
    (new.id, 'trade', 'notes_what_change', 'What would I change?', 'large_notes', '{}'::jsonb, 102, true),
    (new.id, 'trade', 'notes_lessons_learned', 'Lessons Learned', 'large_notes', '{}'::jsonb, 103, true),
    (new.id, 'trade', 'notes_additional', 'Additional Notes', 'large_notes', '{}'::jsonb, 104, true),
    (new.id, 'trade', 'emotion_before', 'Emotion Before Trade', 'tag', '{"choices": ["Calm", "Confident", "Fearful", "FOMO", "Excited", "Hesitant", "Stressed"]}'::jsonb, 110, true),
    (new.id, 'trade', 'emotion_during', 'Emotion During Trade', 'tag', '{"choices": ["Calm", "Confident", "Fearful", "FOMO", "Excited", "Hesitant", "Stressed"]}'::jsonb, 111, true),
    (new.id, 'trade', 'emotion_after', 'Emotion After Trade', 'tag', '{"choices": ["Calm", "Confident", "Fearful", "FOMO", "Excited", "Hesitant", "Stressed"]}'::jsonb, 112, true),
    (new.id, 'trade', 'emotion_intensity', 'Emotion Intensity', 'rating', '{"min": 1, "max": 10}'::jsonb, 113, true),
    (new.id, 'trade', 'trade_mistakes', 'Mistakes', 'tag', '{"choices": ["Moved stop", "Chased entry", "Oversized", "Exited too early", "Let loser run", "Broke strategy rules", "Revenge trade", "FOMO", "No plan"]}'::jsonb, 120, true),
    (new.id, 'investment', 'average_cost', 'Average Cost', 'currency', '{}'::jsonb, 0, true),
    (new.id, 'investment', 'current_price', 'Current Price', 'currency', '{}'::jsonb, 1, true),
    (new.id, 'investment', 'total_shares', 'Total Shares', 'number', '{}'::jsonb, 2, true),
    (new.id, 'investment', 'total_value', 'Total Value', 'currency', '{}'::jsonb, 3, true),
    (new.id, 'investment', 'unrealized_gain_loss', 'Unrealized Gain/Loss', 'currency', '{}'::jsonb, 4, true),
    (new.id, 'investment', 'dividend_yield', 'Dividend Yield', 'percentage', '{}'::jsonb, 5, true),
    (new.id, 'investment', 'long_term_notes', 'Long-Term Notes', 'large_notes', '{}'::jsonb, 6, true);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- ===== 0035_trade_excursions.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically -- see
-- supabase/migrations/*.sql for the existing convention.
--
-- MAE / MFE: how far each trade moved against, and in favour of, the position
-- while it was held.
--
-- WHY THIS IS STORED RATHER THAN COMPUTED ON READ. Every other derived figure
-- in this app is recomputed on demand, precisely so it can never go stale.
-- This one cannot be: the inputs are daily bars from an unofficial, rate-
-- limited third-party endpoint, fetched over the network from this app's own
-- IP. Recomputing a journal's worth of excursions on every page view would be
-- hundreds of outbound requests per render. So the result is written down
-- once, and recomputed only when the user asks.
--
-- A SEPARATE TABLE, NOT COLUMNS ON `trades`. Two reasons:
--   1. "Never computed" and "computed, and there is no data" are different
--      states that a nullable column on `trades` cannot tell apart -- and the
--      difference is exactly what the UI needs to say. A missing row means
--      never asked; a row with status <> 'ok' means asked and answered.
--   2. These are derived from an EXTERNAL source that can be absent, wrong or
--      revised. Keeping them out of `trades` keeps the trade row the user's
--      own record, and means dropping every excursion is one truncate rather
--      than a column migration.

create table trade_excursions (
  -- One row per trade, so recomputation replaces rather than accumulates.
  trade_id uuid primary key references trades(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- The symbol actually queried, which is a GUESS (see guessYahooSymbol:
  -- crypto gets -USD, forex gets =X). Recorded so a wrong result can be
  -- traced to a wrong symbol rather than looking like bad price data.
  symbol text not null,

  -- Why this row exists in whatever state it is in. 'ok' is the only status
  -- carrying figures; the rest explain an empty result so the UI never has to
  -- say "no data" without a reason.
  --   same_day     -- one daily bar cannot separate the hold from the session
  --   no_data      -- outside the history window, delisted, or wrong symbol
  --   no_prices    -- entry or exit price missing on the trade
  --   no_direction -- without long/short there is no "in your favour"
  --   coarse_data  -- the provider returned bars coarser than daily, whose
  --                   highs and lows span far more than the holding period
  status text not null check (
    status in ('ok', 'same_day', 'no_data', 'no_prices', 'no_direction', 'coarse_data')
  ),

  -- Worst and best prices reached while held, and the same as signed moves in
  -- the position's favour: MAE is normally negative, MFE positive. MAE can be
  -- positive when a trade never traded against the entry, which is a real
  -- outcome and is stored as such rather than clamped to zero.
  mae_price numeric,
  mfe_price numeric,
  mae_percent numeric,
  mfe_percent numeric,

  -- The same excursions in R. Null when the trade recorded no stop -- R
  -- without the risk it is a multiple of would be a fabricated denominator.
  mae_r numeric,
  mfe_r numeric,

  -- How many daily bars the answer rests on, and whether the entry/exit day
  -- bars were included. When true the figures are an OUTER BOUND: the entry
  -- day's low may predate the entry. Stored rather than assumed so every
  -- surface can state it.
  candles_used integer not null default 0,
  includes_partial_days boolean not null default false,

  computed_at timestamptz not null default now()
);

-- The dominant read is "every excursion for this user", to build aggregates.
create index trade_excursions_user_idx on trade_excursions (user_id);

alter table trade_excursions enable row level security;

create policy "trade_excursions owner access"
  on trade_excursions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ===== 0036_goals.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically -- see
-- supabase/migrations/*.sql for the existing convention.
--
-- Trading goals: a commitment the trader makes, measured against what they
-- actually did.
--
-- **EVERY GOAL MUST RESOLVE TO A COUNTABLE CONDITION.** The brief is explicit
-- that subjective goals must not be turned into fake numerical scores, so
-- there is deliberately no free-text "goal" with a hand-moved slider. A goal
-- is one of three measurable shapes:
--
--   adherence -- a per-trade condition, met on at least/at most N% of trades.
--                The condition is EXACTLY a plan rule (0033): same subjects,
--                same operators, same evaluator. "Risk <= 1% on 90% of trades"
--                is a plan rule with a target attached.
--   aggregate -- a period metric against a number: trade count, win rate,
--                expectancy, average loss in R, total R.
--   reduction -- how many trades carried a given mistake, from the mistake
--                tracker (0034 + the detectors). "No stop movement" is this,
--                with a target of zero.
--
-- Anything a trader cannot express in one of those shapes is something this
-- app cannot honestly measure, and the editor says so rather than offering a
-- progress bar driven by nothing.
--
-- NOTHING IS STORED PER PERIOD. Progress is recomputed from the trades on
-- every read, so a goal can never disagree with the journal behind it, and
-- correcting a trade immediately corrects every goal that counted it.

create table goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- The trader's own words for it, shown verbatim.
  label text not null,

  kind text not null check (kind in ('adherence', 'aggregate', 'reduction')),

  -- ---- adherence: the per-trade condition -------------------------------
  -- Same vocabulary as strategy_rules (0033). Repeated here rather than
  -- referenced because a goal is not attached to a strategy: it applies to
  -- every trade in the period, whatever it was tagged with.
  subject_source text check (subject_source in ('core', 'derived', 'custom')),
  subject_key text,
  operator text check (
    operator in (
      'lte', 'lt', 'gte', 'gt', 'eq', 'neq', 'between',
      'is_set', 'is_not_set', 'is_true', 'is_false',
      'text_eq', 'text_neq', 'contains'
    )
  ),
  number_value numeric,
  number_value_max numeric,
  text_value text,

  -- ---- aggregate: which measure ------------------------------------------
  -- Each maps to a figure the shared segments engine already computes, so a
  -- goal can never quote a number the Analytics page disagrees with.
  metric text check (
    metric in ('trade_count', 'win_rate', 'expectancy', 'avg_loss_r', 'total_r')
  ),

  -- ---- reduction: which mistake ------------------------------------------
  -- Matches a label the mistake tracker produces, whether detected
  -- automatically or tagged by hand.
  mistake_label text,

  -- ---- the target ---------------------------------------------------------
  -- Units depend on kind: a percentage of trades for adherence, the metric's
  -- own unit for aggregate, a count for reduction.
  target numeric not null,
  -- Which way is success. "At most 3 moved stops" and "at least 20 trades"
  -- are both goals; without this the same number means opposite things.
  target_direction text not null check (target_direction in ('at_least', 'at_most')),

  -- The window progress is measured over, resolved in the trader's own
  -- timezone at read time (see src/lib/goals/evaluate.ts).
  period text not null check (period in ('month', 'quarter', 'year', 'all_time')),

  -- Switched off without deleting, so a goal met and paused keeps its record.
  active boolean not null default true,
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The shape must match the kind, or nothing can evaluate it. Without this a
  -- row can claim to be an adherence goal with no condition, which would sit
  -- on the page forever showing no progress and no reason why.
  constraint goals_shape_matches_kind check (
    (kind = 'adherence' and subject_source is not null and subject_key is not null and operator is not null)
    or (kind = 'aggregate' and metric is not null)
    or (kind = 'reduction' and mistake_label is not null)
  )
);

create index goals_user_idx on goals (user_id, sort_order);

create trigger goals_set_updated_at
  before update on goals
  for each row
  execute function set_updated_at();

alter table goals enable row level security;

create policy "goals owner access"
  on goals for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ===== 0037_suggestion_dismissals.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically -- see
-- supabase/migrations/*.sql for the existing convention.
--
-- Somewhere to record that a suggested tag was turned down.
--
-- WHY THIS IS NEEDED AT ALL. The app can already detect four things about a
-- trade with no help from the trader: a moved stop, a moved target, an exit
-- short of the recorded target, and a position sized well above their own
-- median. Those are recomputed on every read and stored nowhere, which is
-- correct -- but it means a suggestion the trader has considered and rejected
-- comes back every single time they open the trade. On the journal this was
-- built against, 183 trades would permanently suggest "Exited before target".
-- A suggestion that cannot be dismissed is not a suggestion, it is noise, and
-- noise is what teaches people to stop reading a panel.
--
-- A COLUMN ON `trades`, NOT A KEY IN `custom_fields`. custom_fields is the
-- trader's own data -- it is exported, rendered on the form from
-- field_definitions, and fed to the AI prompts under the user's own labels. A
-- housekeeping list of rejected suggestions is none of those things, and
-- putting it there would leak an internal flag into every export and every
-- prompt as though the trader had written it.
--
-- Accepting a suggestion is deliberately NOT recorded here. Accepting writes
-- the label into the Mistakes field (0034) like any other tag, which is the
-- whole point: an approved suggestion becomes ordinary journal data that the
-- mistake tracker, goals and reports already read. Only the rejection needs
-- somewhere to live.

alter table trades
  add column dismissed_suggestions text[] not null default '{}'::text[];

-- No index: this is only ever read as part of the row it belongs to, never
-- filtered or joined on.
--
-- No RLS change either. `trades` already carries an owner policy, and a new
-- column on an existing table inherits it -- unlike user_settings (0024),
-- `trades` has never had its table-level grants revoked, so the column is
-- writable by its owner as soon as it exists.
--
-- The 0008 history trigger snapshots the whole row, so dismissals would
-- otherwise appear in trade_history. They stay invisible in the timeline
-- either way -- src/lib/replay/build.ts replays an explicit list of fields and
-- this is not one of them -- but they were still consuming one of the 50
-- retention slots 0023 allows per trade, which on a heavily edited trade means
-- deleting a real edit to record a dismissal. **Migration 0038 fixes that and
-- must be applied alongside this one.**

-- ===== 0038_skip_dismissal_snapshots.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. This project has no migration runner -- see the header of every
-- other file in supabase/migrations.
--
-- Stop a dismissed tag suggestion from evicting real edit history.
--
-- THE BUG THIS FIXES, WHICH 0037 INTRODUCED. 0008's trigger is `before update
-- on trades for each row` with no WHEN clause, so it snapshots the row on
-- EVERY update -- including one that only appends to dismissed_suggestions.
-- 0023 then caps retention at the newest 50 snapshots per trade. Put together,
-- dismissing four suggestions on a trade burns four of those fifty slots and
-- permanently deletes the four oldest genuine edits.
--
-- That is not hypothetical on this database: measured before writing this, 5
-- trades sit exactly at the 50 cap and 6 are within four of it. On those,
-- every dismissal costs a real snapshot.
--
-- THE FIX. Skip the snapshot when the update changed nothing a reader of the
-- history could care about. The comparison is deliberately conservative -- it
-- skips only when every other column is byte-identical, so anything ambiguous
-- still gets snapshotted, and the failure mode is an extra row rather than a
-- lost one.
--
-- `updated_at` is excluded because trades_set_updated_at is also a BEFORE
-- UPDATE trigger on this table and sorts ahead of this one alphabetically, so
-- it has already stamped new.updated_at by the time this runs. Comparing it
-- would make every update look like a change and defeat the whole check.
--
-- A no-op update -- the autosave writing back values the user did not actually
-- change -- now also produces no snapshot. That is a second, smaller win, not
-- a side effect to worry about: a snapshot identical to its neighbour was
-- already invisible in the timeline, which skips consecutive duplicates
-- (src/lib/replay/build.ts), and was only ever consuming a retention slot.

create or replace function snapshot_trade_history()
returns trigger as $$
begin
  if to_jsonb(old) - 'dismissed_suggestions' - 'updated_at'
     is not distinct from
     to_jsonb(new) - 'dismissed_suggestions' - 'updated_at'
  then
    return new;
  end if;

  insert into trade_history (trade_id, user_id, snapshot)
  values (old.id, old.user_id, to_jsonb(old));
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- The trigger itself is unchanged; `create or replace function` is picked up
-- by the existing trades_snapshot_history trigger with no re-creation needed.

-- ===== 0039_order_types.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. This project has no migration runner -- see the header of every
-- other file in supabase/migrations.
--
-- Order types, a custom escape hatch, and time in force.
--
-- WHAT THIS FIXES, NOT JUST WHAT IT ADDS. Until now the app stored a single
-- trigger price with no order sub-type, so auto-execution had to fill a
-- pending order whenever the session's range merely BRACKETED that price
-- (src/lib/trades/auto-execute.ts said so in as many words). A buy limit at
-- $95 therefore filled when price ROSE through $95, which is not what a limit
-- order does. Recording the type is what lets the fill be directional.
--
-- ORDER TYPE IS text + CHECK, NOT A POSTGRES ENUM. `status` is an enum and
-- extending it needs ALTER TYPE ... ADD VALUE, which cannot be used in the
-- same transaction that adds it and is awkward to roll back. This column will
-- gain values over time, so a CHECK constraint that can be replaced in one
-- statement is the better shape.

alter table trades
  add column order_type text
    check (order_type in ('market', 'limit', 'stop', 'stop_limit', 'trailing_stop', 'other')),

  -- Only meaningful when order_type = 'other'. Bounded for the same reason
  -- ticker and company_name are bounded in lib/trades/schema.ts: this column
  -- rides into every CSV/XLSX export and renders in the trades table, and
  -- Postgres `text` would otherwise accept a pasted document.
  add column order_type_other text check (char_length(order_type_other) <= 64),

  -- The second price a stop-limit needs: the stop triggers, then the order
  -- rests as a limit at this price. Null for every other type.
  add column limit_price numeric,

  -- Good-til-cancelled is the default because it is what the app already did
  -- implicitly: a pending order sat there until it filled or the user removed
  -- it. Existing rows therefore keep behaving exactly as they do today.
  add column time_in_force text not null default 'gtc'
    check (time_in_force in ('gtc', 'day'));

-- A day order that never filled is not "closed" -- it never opened, so it has
-- no entry, no exit and no P&L. It needs a state of its own.
--
-- Safe to add: every statistic in this app selects `status = 'closed'` and the
-- committed-cash RPC selects `status in ('open', 'pending')`. Both are
-- positive predicates, checked across 0021/0025/0027 and every query in
-- src/lib, so a new value cannot leak into a number. It simply stops matching.
--
-- If the SQL editor rejects this with "ALTER TYPE ... cannot run inside a
-- transaction block", run this one line on its own first, then the rest.
alter type trade_status add value if not exists 'expired';

-- Finding resting orders to sweep. The auto-execute job reads pending orders
-- across every user, and day orders now need an expiry check on top of the
-- fill check, so both go through this.
create index if not exists trades_pending_tif_idx
  on trades (status, time_in_force)
  where status = 'pending';

comment on column trades.order_type is
  'Null means unspecified. Auto-execution keeps its original bracket behaviour for null, so applying this migration cannot change how an existing resting order fills.';

-- ===== 0040_schema_migrations.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. This project has no migration runner -- see the header of every
-- other file in supabase/migrations.
--
-- NEW CONVENTION STARTS HERE: every migration from this one onward MUST end
-- with its own self-recording insert, exactly like the last statement in this
-- file:
--
--     insert into schema_migrations (filename)
--     values ('00NN_description.sql')
--     on conflict do nothing;
--
-- Copy that into every new migration and update the filename. Pasting the
-- file into the SQL editor is then the same act as recording it applied,
-- which is the only reason this table can be trusted -- a separate "remember
-- to also run the insert" step would be forgotten on the first busy day.
-- `on conflict do nothing` makes re-running a file harmless.
--
--
-- WHY THIS TABLE EXISTS. Twenty files (0020 onward) are applied by hand and
-- nothing in the repo records which of them actually reached the live
-- database. "Is 0033 applied?" has so far been answered from memory, and that
-- has already gone wrong once at real cost: scripts/check-rpc-parity.ts
-- exists because the dashboard and the position-size prefill disagreed by
-- $24,212.50 -- a fix had landed in JS while its migration sat unapplied.
--
-- This does NOT introduce a migration runner. Applying SQL stays manual and
-- deliberate; the change is only that the applied/pending split becomes a
-- fact `npm run migrations:status` can check, instead of something a person
-- has to recall. src/lib/supabase/errors.ts (42P01/PGRST205 for a missing
-- table, PGRST204/42703 for a missing column) remains the runtime safety net
-- and is unaffected -- this makes the known state explicit, it does not
-- replace degrading gracefully when that state is wrong.

create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
);

-- LOCKED DOWN, AND THE REVOKE IS NOT OPTIONAL. Supabase ships default
-- privileges granting `anon` and `authenticated` full table access on
-- anything new in `public`, so a bare `create table` here would be reachable
-- through PostgREST the moment it existed. RLS with no policies would return
-- nothing to those roles, but the endpoint itself would still be there,
-- confirming the table's existence and column names to any anonymous caller.
-- Revoking removes the endpoint rather than merely emptying it.
--
-- `service_role` deliberately keeps its grant: it bypasses RLS, and it is how
-- scripts/migrations-status.ts reads this table. Nothing in the app -- no
-- route handler, no client component -- reads or writes it.
revoke all on schema_migrations from anon, authenticated;

-- Enabled with zero policies on purpose: belt to the revoke's braces. If a
-- future migration ever re-grants this table wholesale (0037 notes that
-- `trades` picked up exactly that kind of accidental table-level grant), RLS
-- is the second lock that still denies every non-service-role read.
alter table schema_migrations enable row level security;

-- BACKFILL, WITH HONEST DATES. 0000-0038 were verified live on 4 Sep 2026 by
-- running a real select against each table they create -- these timestamps
-- are that verification date, not the date each file was originally applied,
-- which nobody recorded. 0039 was applied on 7 Sep 2026 and reported as run
-- but never independently re-verified; it is dated accordingly and is the one
-- row here to treat with any suspicion.
--
-- Noon UTC rather than midnight, so the dates read the same in every timezone
-- this project is ever looked at from.
insert into schema_migrations (filename, applied_at)
values
  ('0000_reset.sql',                                     '2026-09-04T12:00:00Z'),
  ('0001_field_definitions_and_trades.sql',              '2026-09-04T12:00:00Z'),
  ('0002_seed_default_fields.sql',                       '2026-09-04T12:00:00Z'),
  ('0003_user_settings.sql',                             '2026-09-04T12:00:00Z'),
  ('0004_folders.sql',                                   '2026-09-04T12:00:00Z'),
  ('0005_search_indexes.sql',                            '2026-09-04T12:00:00Z'),
  ('0006_strategy_tags_field.sql',                       '2026-09-04T12:00:00Z'),
  ('0007_emotion_intensity_field.sql',                   '2026-09-04T12:00:00Z'),
  ('0008_trade_history.sql',                             '2026-09-04T12:00:00Z'),
  ('0009_dashboard_layout.sql',                          '2026-09-04T12:00:00Z'),
  ('0010_trade_images.sql',                              '2026-09-04T12:00:00Z'),
  ('0011_user_timezone.sql',                             '2026-09-04T12:00:00Z'),
  ('0012_trade_images_bucket.sql',                       '2026-09-04T12:00:00Z'),
  ('0013_analytics.sql',                                 '2026-09-04T12:00:00Z'),
  ('0014_analytics_grants.sql',                          '2026-09-04T12:00:00Z'),
  ('0015_fix_overview_stats.sql',                        '2026-09-04T12:00:00Z'),
  ('0016_account_transactions.sql',                      '2026-09-04T12:00:00Z'),
  ('0017_strategies.sql',                                '2026-09-04T12:00:00Z'),
  ('0018_retire_strategy_setup_field.sql',               '2026-09-04T12:00:00Z'),
  ('0019_analytics_cascade_delete.sql',                  '2026-09-04T12:00:00Z'),
  ('0020_dashboard_stats_rpc.sql',                       '2026-09-04T12:00:00Z'),
  ('0021_dashboard_stats_investment_committed_cash.sql', '2026-09-04T12:00:00Z'),
  ('0022_commissions.sql',                               '2026-09-04T12:00:00Z'),
  ('0023_trade_history_retention.sql',                   '2026-09-04T12:00:00Z'),
  ('0024_user_settings_column_grants.sql',               '2026-09-04T12:00:00Z'),
  ('0025_realized_pl_requires_closed.sql',               '2026-09-04T12:00:00Z'),
  ('0026_setup_tie_shows_no_worst.sql',                  '2026-09-04T12:00:00Z'),
  ('0027_committed_cash_includes_pending.sql',           '2026-09-04T12:00:00Z'),
  ('0028_trade_folders_strategies_ownership.sql',        '2026-09-04T12:00:00Z'),
  ('0029_ai_keys_and_plan.sql',                          '2026-09-04T12:00:00Z'),
  ('0030_more_ai_providers.sql',                         '2026-09-04T12:00:00Z'),
  ('0031_ai_provider_consent.sql',                       '2026-09-04T12:00:00Z'),
  ('0032_ai_reviews.sql',                                '2026-09-04T12:00:00Z'),
  ('0033_strategy_rules.sql',                            '2026-09-04T12:00:00Z'),
  ('0034_trade_mistakes_field.sql',                      '2026-09-04T12:00:00Z'),
  ('0035_trade_excursions.sql',                          '2026-09-04T12:00:00Z'),
  ('0036_goals.sql',                                     '2026-09-04T12:00:00Z'),
  ('0037_suggestion_dismissals.sql',                     '2026-09-04T12:00:00Z'),
  ('0038_skip_dismissal_snapshots.sql',                  '2026-09-04T12:00:00Z'),
  ('0039_order_types.sql',                               '2026-09-07T12:00:00Z')
on conflict do nothing;

-- This file records itself, per the convention documented at the top. Note it
-- takes the `now()` default rather than a hardcoded date -- unlike every row
-- above, the moment this runs IS the moment it was applied.
insert into schema_migrations (filename)
values ('0040_schema_migrations.sql')
on conflict do nothing;

-- ===== 0041_more_free_ai_providers.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically -- see
-- supabase/migrations/*.sql for the existing convention.
--
-- Adds three more AI providers, all with a usable free tier: Mistral AI,
-- SambaNova Cloud and GitHub Models. All three speak the OpenAI-compatible
-- /chat/completions API, so they share the one adapter in
-- src/lib/ai-keys/providers/openai-compatible.ts rather than getting an
-- integration each.
--
-- Two constraints pin the allowed provider strings, and BOTH must be widened
-- or half the flow breaks: user_api_keys (0030) gates storing a key, and
-- ai_provider_consents (0031) gates recording that the user agreed to send
-- their journal to that provider. They must stay in sync with AI_PROVIDERS in
-- src/lib/ai-keys/types.ts and the zod enum built from it.
--
-- Widening a check constraint only *permits* more values; existing rows are
-- unaffected, so this is safe to apply at any time (ideally before the code
-- that offers the new providers, or a key save will hit the old constraint).

-- The constraint names are the ones Postgres generates for an inline column
-- check on each table. `if exists` keeps this re-runnable and tolerant of a
-- differently-named constraint, which would then need dropping by hand --
-- check with:
--   select conname from pg_constraint where conrelid = 'user_api_keys'::regclass;
--   select conname from pg_constraint where conrelid = 'ai_provider_consents'::regclass;

alter table user_api_keys
  drop constraint if exists user_api_keys_provider_check;

alter table user_api_keys
  add constraint user_api_keys_provider_check
  check (provider in (
    'openai', 'anthropic', 'google', 'groq', 'openrouter', 'cerebras',
    'mistral', 'sambanova', 'github'
  ));

alter table ai_provider_consents
  drop constraint if exists ai_provider_consents_provider_check;

alter table ai_provider_consents
  add constraint ai_provider_consents_provider_check
  check (provider in (
    'openai', 'anthropic', 'google', 'groq', 'openrouter', 'cerebras',
    'mistral', 'sambanova', 'github'
  ));

-- Self-records per the convention in 0040_schema_migrations.sql. Missing on
-- this file's first release -- caught by `npm run migrations:status` showing
-- it PENDING despite both constraints being live -- so this insert was added
-- after the fact and the live database's tracking row was corrected directly.
insert into schema_migrations (filename)
values ('0041_more_free_ai_providers.sql')
on conflict do nothing;

-- ===== 0042_rate_limit_counters.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically -- see
-- supabase/migrations/*.sql for the existing convention.
--
-- Turns the application rate limiter into a GLOBAL one. Until now the counters
-- lived in per-serverless-instance memory (src/lib/rate-limit.ts), so a client
-- whose requests spread across warm instances got a proportionally higher
-- effective limit, and every cold start reset the window. This backs the limit
-- with one shared table so the ceiling is real across the whole deployment.
--
-- The limiter FAILS OPEN in the app: if this function is missing (migration not
-- yet applied) or the DB is briefly unreachable, requests are allowed rather
-- than blocked -- a limiter that breaks the app it protects is worse than none.
-- So deploying the code before this migration is applied is harmless; applying
-- it is simply what switches the global ceiling on.

create table if not exists rate_limit_counters (
  -- Server-constructed key, e.g. 'api:<userId>', 'api-anon:<ip>', 'ocr:<userId>'.
  bucket text primary key,
  -- Start of the current fixed window. A bucket's row is reused in place, so
  -- the table grows only with the number of distinct buckets seen, not with
  -- request volume; the nightly prune below drops cold ones.
  window_start timestamptz not null default now(),
  count int not null default 0
);

-- RLS on with NO policies: the table is written and read ONLY through the
-- security-definer function below, never directly by anon/authenticated. Even
-- if it somehow were, RLS denies every direct row access.
alter table rate_limit_counters enable row level security;

-- Supports the opportunistic prune inside the function below.
create index if not exists rate_limit_counters_window_start_idx
  on rate_limit_counters (window_start);

-- One atomic hit against a bucket. Returns whether the request is allowed and,
-- when not, how many seconds until the window resets.
--
-- security definer so it can touch the RLS-locked table as its owner. The one
-- statement is atomic: concurrent hits on the same bucket serialize on the
-- primary-key row via ON CONFLICT, so the count can't race.
create or replace function rate_limit_hit(p_bucket text, p_max int, p_window_seconds int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  w interval := make_interval(secs => p_window_seconds);
  cur_count int;
  cur_start timestamptz;
begin
  insert into rate_limit_counters as r (bucket, window_start, count)
    values (p_bucket, now(), 1)
  on conflict (bucket) do update
    -- Window elapsed -> start a fresh window at 1; otherwise increment.
    set count        = case when r.window_start < now() - w then 1     else r.count + 1 end,
        window_start = case when r.window_start < now() - w then now() else r.window_start end
  returning r.count, r.window_start into cur_count, cur_start;

  -- Opportunistic cleanup: a bucket's row is reused in place, so the table
  -- only grows with distinct buckets (users + IPs + CSP signatures) seen. On
  -- roughly 1% of calls, drop rows whose window ended over a day ago so cold
  -- buckets don't linger forever. Cheap via the window_start index, and rare
  -- enough not to sit on the hot path of every request.
  if random() < 0.01 then
    delete from rate_limit_counters where window_start < now() - interval '1 day';
  end if;

  return jsonb_build_object(
    'allowed', cur_count <= p_max,
    'retry_after_seconds',
      case when cur_count <= p_max then 0
           else greatest(1, ceil(extract(epoch from (cur_start + w - now())))::int)
      end
  );
end;
$$;

-- **Only service_role may call it.** The app's rate-limit module uses the
-- service-role key (server-only). Deliberately NOT granted to anon/authenticated:
-- the anon key ships in the browser bundle, so a public grant would let anyone
-- call rate_limit_hit('api:<victimUserId>', ...) repeatedly and pre-exhaust
-- another user's bucket -- a denial-of-service handed out for free.
revoke all on function rate_limit_hit(text, int, int) from public;
grant execute on function rate_limit_hit(text, int, int) to service_role;

-- Self-records per the convention in 0040_schema_migrations.sql. Missing on
-- this file's first release -- caught by `npm run migrations:status` showing
-- it PENDING despite the function already being live and answering correctly
-- -- so this insert was added after the fact and the live database's
-- tracking row was corrected directly.
insert into schema_migrations (filename)
values ('0042_rate_limit_counters.sql')
on conflict do nothing;

-- ===== 0043_admin_users.sql =====
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

-- ===== 0044_analytics_exclusions.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically -- see
-- supabase/migrations/*.sql for the existing convention.
--
-- Excludes test and demo accounts from admin analytics, two ways:
--
--   1. AUTOMATIC, by email domain. Any address on a reserved test TLD
--      (.test, .invalid, .example, .localhost -- RFC 2606, the same standard
--      the e2e suite's own throwaway addresses already use) is excluded from
--      every aggregate, with no action needed. A tool that creates accounts
--      to test the live signup form on a domain like this is excluded the
--      first time it ever shows up, not just after someone notices it.
--
--   2. MANUAL, via a per-account flag. `user_settings.excluded_from_analytics`
--      covers everything the domain rule cannot -- most importantly this
--      project's own demo@tradinglens.app showcase account, which sits on a
--      real domain and is a deliberate, curated account rather than test
--      junk, but still is not a real user and would skew signup/usage counts.
--      Set once here for that account; toggleable per-account afterward from
--      /admin/users.
--
-- The rewritten functions below are `create or replace` over the ones 0013
-- and 0043 already defined -- same signatures, same return shapes, so no
-- caller (admin-queries.ts) needs to change. Only the WHERE clauses grow a
-- filter. `admin_user_directory` is the one exception: it does not drop
-- excluded rows, it labels them, because the manual toggle needs somewhere
-- to click.

-- NO GRANT FOR THIS COLUMN -- THAT OMISSION IS THE SECURITY CONTROL, same
-- pattern as `is_admin` (0013) and `plan` (0029). A newly added column on a
-- table already under column-level grants starts with zero write privilege;
-- this is settable only through admin_set_user_excluded() below, which
-- checks is_admin itself, or the Supabase dashboard. If `user_settings` ever
-- needs a bare `grant update` restored, do not let `excluded_from_analytics`
-- ride along in that grant's column list -- a user hiding their own account
-- from your analytics is a smaller problem than a user hiding someone else's,
-- but it is still not theirs to decide.
alter table user_settings
  add column if not exists excluded_from_analytics boolean not null default false;

-- The regex is repeated inline in each function below rather than factored
-- into a shared helper: every other admin_* function in this project is
-- fully self-contained with no shared SQL helpers, and one predicate copied
-- six times reads easier than a dependency none of the surrounding code has.
--
--   u.email !~* '@[^@]+\.(test|invalid|example|localhost)$'
--
-- matches "not on a reserved test TLD" -- true for a real address, false for
-- anything@anything.test, .invalid, .example or .localhost.

-- 1. admin_overview_stats() -- now also reports how many accounts it hid, so
--    "Total users: 5" doesn't read as a lower number with no explanation.

-- `create or replace` cannot change a function's OUT-parameter shape (Postgres
-- error 42P13); this one gains `excluded_count`, so the old version must be
-- dropped first. `admin_usage_series`, `admin_feature_usage` and
-- `admin_retention_cohorts` below keep their original return shape -- only
-- their WHERE clauses change -- so `create or replace` is enough for those.
drop function if exists admin_overview_stats();

create or replace function admin_overview_stats()
returns table (
  total_users bigint,
  signups_today bigint,
  dau bigint,
  wau bigint,
  mau bigint,
  avg_session_seconds_today numeric,
  median_session_seconds_today numeric,
  excluded_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from user_settings where user_id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;

  return query
  with real_users as (
    select u.id, u.created_at
    from auth.users u
    left join user_settings s on s.user_id = u.id
    where not coalesce(s.excluded_from_analytics, false)
      and u.email !~* '@[^@]+\.(test|invalid|example|localhost)$'
  )
  select
    (select count(*) from real_users),
    (select count(*) from real_users where created_at >= date_trunc('day', now())),
    (select count(distinct e.user_id) from analytics_events e
       join real_users r on r.id = e.user_id
       where e.created_at >= now() - interval '1 day'),
    (select count(distinct e.user_id) from analytics_events e
       join real_users r on r.id = e.user_id
       where e.created_at >= now() - interval '7 days'),
    (select count(distinct e.user_id) from analytics_events e
       join real_users r on r.id = e.user_id
       where e.created_at >= now() - interval '30 days'),
    (select avg(ses.duration_seconds) from analytics_sessions ses
       join real_users r on r.id = ses.user_id
       where ses.started_at >= date_trunc('day', now())),
    -- Bug carried over from 0013, fixed here: percentile_cont() has no
    -- numeric-input overload at all -- only double precision and interval --
    -- so it always returns double precision, which never matched this
    -- column's declared `numeric`. Postgres error 42804 at execution time.
    -- It stayed silent until a session row with real duration_seconds existed
    -- for "today" at the moment an admin loaded the page, which is exactly
    -- what surfaced it. (A first attempt at this fix cast the SORT KEY to
    -- numeric instead of the result -- that gets silently re-cast back to
    -- double precision to match the only overload that exists, so it changed
    -- nothing. The cast has to land on the aggregate's output.)
    (select (percentile_cont(0.5) within group (order by ses.duration_seconds))::numeric
       from analytics_sessions ses
       join real_users r on r.id = ses.user_id
       where ses.started_at >= date_trunc('day', now())),
    (select count(*) from auth.users) - (select count(*) from real_users);
end;
$$;

-- 2. admin_usage_series() -- signups and DAU per day, same exclusion.

create or replace function admin_usage_series(p_days int default 30)
returns table (day date, signups bigint, dau bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from user_settings where user_id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;

  return query
  with days as (
    select generate_series(current_date - (p_days - 1), current_date, interval '1 day')::date as day
  ),
  real_users as (
    select u.id, u.created_at
    from auth.users u
    left join user_settings s on s.user_id = u.id
    where not coalesce(s.excluded_from_analytics, false)
      and u.email !~* '@[^@]+\.(test|invalid|example|localhost)$'
  ),
  signups as (
    select created_at::date as day, count(*) as signups
    from real_users
    group by 1
  ),
  active as (
    select e.created_at::date as day, count(distinct e.user_id) as dau
    from analytics_events e
    join real_users r on r.id = e.user_id
    group by 1
  )
  select d.day, coalesce(s.signups, 0), coalesce(a.dau, 0)
  from days d
  left join signups s on s.day = d.day
  left join active a on a.day = d.day
  order by d.day;
end;
$$;

-- 3. admin_feature_usage() -- excluded accounts' clicks and feature use no
--    longer inflate "what gets used".

create or replace function admin_feature_usage(p_days int default 30)
returns table (event_name text, count bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from user_settings where user_id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;

  return query
  select e.event_name, count(*) as count
  from analytics_events e
  join auth.users u on u.id = e.user_id
  left join user_settings s on s.user_id = e.user_id
  where e.created_at >= now() - (p_days || ' days')::interval
    and e.event_name not in ('page_view', 'session_start')
    and not coalesce(s.excluded_from_analytics, false)
    and u.email !~* '@[^@]+\.(test|invalid|example|localhost)$'
  group by e.event_name
  order by count desc
  limit 20;
end;
$$;

-- 4. admin_retention_cohorts() -- a hidden account was never eligible to
--    join a cohort in the first place, not merely excluded from the result.

create or replace function admin_retention_cohorts(p_weeks int default 8)
returns table (cohort_week date, cohort_size bigint, retained_next_week bigint, retention_pct numeric)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from user_settings where user_id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;

  return query
  with cohorts as (
    select u.id as user_id, date_trunc('week', u.created_at)::date as cohort_week
    from auth.users u
    left join user_settings s on s.user_id = u.id
    where u.created_at >= now() - (p_weeks || ' weeks')::interval
      and not coalesce(s.excluded_from_analytics, false)
      and u.email !~* '@[^@]+\.(test|invalid|example|localhost)$'
  ),
  active_weeks as (
    select distinct user_id, date_trunc('week', created_at)::date as active_week
    from analytics_events
  )
  select
    c.cohort_week,
    count(distinct c.user_id) as cohort_size,
    count(distinct case when aw.active_week = c.cohort_week + interval '7 day' then c.user_id end) as retained_next_week,
    round(
      count(distinct case when aw.active_week = c.cohort_week + interval '7 day' then c.user_id end)::numeric
      / nullif(count(distinct c.user_id), 0) * 100, 1
    ) as retention_pct
  from cohorts c
  left join active_weeks aw on aw.user_id = c.user_id
  group by c.cohort_week
  order by c.cohort_week;
end;
$$;

-- 5. admin_public_views() -- the visitor-vs-signup funnel excludes hidden
--    accounts from the signup side, the same as everywhere else that counts
--    a signup. Views themselves are anonymous and untouched.

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
    left join user_settings us on us.user_id = u.id
    where not coalesce(us.excluded_from_analytics, false)
      and u.email !~* '@[^@]+\.(test|invalid|example|localhost)$'
    group by 1
  )
  select d.day, coalesce(v.views, 0), coalesce(s.signups, 0)
  from days d
  left join v on v.day = d.day
  left join s on s.day = d.day
  order by d.day;
end;
$$;

-- 6. admin_user_directory() -- rows are NOT dropped here. The manual toggle
--    needs an account to click on, so an excluded row still appears, marked,
--    while it disappears from every count and chart above.

-- Same reason as admin_overview_stats() above: this gains an `excluded`
-- output column, so the 0043 version must be dropped before it can be
-- recreated with a different shape.
drop function if exists admin_user_directory();

create or replace function admin_user_directory()
returns table (
  id uuid,
  email text,
  signed_up_at timestamptz,
  plan text,
  admin boolean,
  excluded boolean,
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
    coalesce(s.excluded_from_analytics, false)
      or u.email ~* '@[^@]+\.(test|invalid|example|localhost)$',
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

-- 7. The manual toggle. Anyone with is_admin can flip any account's flag --
--    same authority an admin already has over `plan` via /api/admin/plan.

create or replace function admin_set_user_excluded(p_user_id uuid, p_excluded boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from user_settings us where us.user_id = auth.uid() and us.is_admin) then
    raise exception 'not authorized';
  end if;

  update user_settings
  set excluded_from_analytics = p_excluded
  where user_id = p_user_id;
end;
$$;

revoke all on function admin_set_user_excluded(uuid, boolean) from public;
grant execute on function admin_set_user_excluded(uuid, boolean) to authenticated;

-- 8. Seed: demo@tradinglens.app (id verified live against auth.users before
--    writing this migration) is a deliberate showcase account, not test
--    junk, so the domain rule above does not catch it. Excluded by owner
--    decision, same authority as the toggle above -- this just applies it
--    once instead of requiring a click after the migration runs.
update user_settings
set excluded_from_analytics = true
where user_id = '456454b2-53c2-4252-9ae5-e8f8fe7935c2';

-- Self-records per the convention in 0040_schema_migrations.sql.
insert into schema_migrations (filename)
values ('0044_analytics_exclusions.sql')
on conflict do nothing;

-- ===== 0045_heartbeat_increment.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically.
--
-- Fixes session time never accumulating for anyone who is not an admin.
--
-- `upsertHeartbeat` did read-then-write: SELECT the row, then UPDATE if found
-- or INSERT if not. But 0013 gives analytics_sessions only three policies --
-- insert-own, update-own, and admin-only SELECT -- and that omission is
-- deliberate: "Regular users may only insert their own events/session rows,
-- never read any rows (their own or others')".
--
-- So for a normal user the SELECT returned nothing on every beat, the code
-- took the INSERT branch every time, and each insert after the first hit the
-- primary key. supabase-js *returns* that error rather than throwing, so the
-- surrounding try/catch never fired and it failed silently, forever.
--
-- Measured before this migration:
--
--     non-admin   42 sessions   41 with duration_seconds = 0   longest 90s
--     admin       73 sessions   15 with duration_seconds = 0   longest 2370s
--
-- Admins accumulated time only because the admin SELECT policy let their own
-- read succeed. The visible damage was the "Active time" column and the
-- avg/median session stats, which showed a dash for every real user.
--
-- The fix deliberately does NOT add a select-own policy, which would undo
-- 0013's privacy decision to make these rows unreadable by their own owner.
-- Instead the increment moves server-side, where it needs no read at all --
-- and becomes atomic, which read-then-write never was: two tabs beating at
-- once could both read the same value and each write back +30, losing one.

create or replace function record_heartbeat(p_session_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The session's owner is taken from the JWT, never from an argument, so a
  -- caller can only ever create or extend their own row.
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into analytics_sessions (id, user_id, duration_seconds, started_at, last_seen_at)
  values (p_session_id, auth.uid(), 0, now(), now())
  on conflict (id) do update
    -- 30 seconds must match HEARTBEAT_INCREMENT_SECONDS in
    -- src/lib/tracking/log.ts, which is also the client's beat interval.
    -- Changing one without the other makes time-on-site quietly wrong.
    set duration_seconds = analytics_sessions.duration_seconds + 30,
        last_seen_at = now()
    -- Guards against a caller passing someone else's session id: the row is
    -- simply not updated rather than the beat being credited to them. The
    -- first beat of a session inserts 0, so a session's total is always
    -- (beats - 1) * 30, exactly as before.
    where analytics_sessions.user_id = auth.uid();
end;
$$;

revoke all on function record_heartbeat(text) from public;
grant execute on function record_heartbeat(text) to authenticated;

-- Self-records per the convention in 0040_schema_migrations.sql.
insert into schema_migrations (filename)
values ('0045_heartbeat_increment.sql')
on conflict do nothing;

-- ===== 0046_restore_grants_and_null_email.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically.
--
-- Two small corrections to 0044, neither user-visible today.

-- 1. Restore the execute grants 0044 discarded.
--
-- 0044 had to `drop function` admin_overview_stats() and
-- admin_user_directory() before recreating them, because both gained an
-- output column and `create or replace` cannot change a function's return
-- shape. DROP also discards the function's ACL, and 0044 never put it back,
-- so both silently reverted to Postgres's default of EXECUTE TO PUBLIC --
-- undoing the hardening 0014 and 0043 applied deliberately.
--
-- Not exploitable: each function re-checks is_admin internally and auth.uid()
-- is null for the anon role, so an anonymous call raises 'not authorized'
-- rather than returning data. But the layer is meant to be there, and if this
-- project ever applies `alter default privileges ... revoke execute ... from
-- public` (exactly what 0014 was written to guard against) the missing grant
-- would make both functions uncallable by `authenticated` -- taking out
-- /admin/analytics and /admin/users with a confusing error.
revoke all on function admin_overview_stats() from public;
grant execute on function admin_overview_stats() to authenticated;

revoke all on function admin_user_directory() from public;
grant execute on function admin_user_directory() to authenticated;

-- 2. Treat an account with no email as a real account, not an excluded one.
--
-- Every exclusion predicate in 0044 reads
--     u.email !~* '@[^@]+\.(test|invalid|example|localhost)$'
-- and `NULL !~* ...` evaluates to NULL, not true. So a row with no email
-- fails the WHERE and silently drops out of real_users, the cohorts and the
-- feature usage -- while admin_user_directory computes the inverse and
-- returns `excluded: NULL`, which reaches TypeScript as a falsy value and
-- renders the row as NOT excluded. The aggregates and the directory would
-- therefore disagree about the same account.
--
-- Harmless right now, because this app is email/password only and
-- auth.users.email is always populated. It would switch on silently the day
-- phone or anonymous sign-in is added, which is exactly the kind of thing
-- that is impossible to find later. coalesce() settles it: no email means
-- nothing to match, so the account is ordinary and counts.

create or replace function admin_overview_stats()
returns table (
  total_users bigint,
  signups_today bigint,
  dau bigint,
  wau bigint,
  mau bigint,
  avg_session_seconds_today numeric,
  median_session_seconds_today numeric,
  excluded_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from user_settings where user_id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;

  return query
  with real_users as (
    select u.id, u.created_at
    from auth.users u
    left join user_settings s on s.user_id = u.id
    where not coalesce(s.excluded_from_analytics, false)
      and not coalesce(u.email ~* '@[^@]+\.(test|invalid|example|localhost)$', false)
  )
  select
    (select count(*) from real_users),
    (select count(*) from real_users where created_at >= date_trunc('day', now())),
    (select count(distinct e.user_id) from analytics_events e
       join real_users r on r.id = e.user_id
       where e.created_at >= now() - interval '1 day'),
    (select count(distinct e.user_id) from analytics_events e
       join real_users r on r.id = e.user_id
       where e.created_at >= now() - interval '7 days'),
    (select count(distinct e.user_id) from analytics_events e
       join real_users r on r.id = e.user_id
       where e.created_at >= now() - interval '30 days'),
    (select avg(ses.duration_seconds) from analytics_sessions ses
       join real_users r on r.id = ses.user_id
       where ses.started_at >= date_trunc('day', now())),
    (select (percentile_cont(0.5) within group (order by ses.duration_seconds))::numeric
       from analytics_sessions ses
       join real_users r on r.id = ses.user_id
       where ses.started_at >= date_trunc('day', now())),
    (select count(*) from auth.users) - (select count(*) from real_users);
end;
$$;

revoke all on function admin_overview_stats() from public;
grant execute on function admin_overview_stats() to authenticated;

create or replace function admin_usage_series(p_days int default 30)
returns table (day date, signups bigint, dau bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from user_settings where user_id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;

  return query
  with days as (
    select generate_series(current_date - (p_days - 1), current_date, interval '1 day')::date as day
  ),
  real_users as (
    select u.id, u.created_at
    from auth.users u
    left join user_settings s on s.user_id = u.id
    where not coalesce(s.excluded_from_analytics, false)
      and not coalesce(u.email ~* '@[^@]+\.(test|invalid|example|localhost)$', false)
  ),
  signups as (
    select created_at::date as day, count(*) as signups
    from real_users
    group by 1
  ),
  active as (
    select e.created_at::date as day, count(distinct e.user_id) as dau
    from analytics_events e
    join real_users r on r.id = e.user_id
    group by 1
  )
  select d.day, coalesce(s.signups, 0), coalesce(a.dau, 0)
  from days d
  left join signups s on s.day = d.day
  left join active a on a.day = d.day
  order by d.day;
end;
$$;

create or replace function admin_feature_usage(p_days int default 30)
returns table (event_name text, count bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from user_settings where user_id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;

  return query
  select e.event_name, count(*) as count
  from analytics_events e
  join auth.users u on u.id = e.user_id
  left join user_settings s on s.user_id = e.user_id
  where e.created_at >= now() - (p_days || ' days')::interval
    and e.event_name not in ('page_view', 'session_start')
    and not coalesce(s.excluded_from_analytics, false)
    and not coalesce(u.email ~* '@[^@]+\.(test|invalid|example|localhost)$', false)
  group by e.event_name
  order by count desc
  limit 20;
end;
$$;

create or replace function admin_retention_cohorts(p_weeks int default 8)
returns table (cohort_week date, cohort_size bigint, retained_next_week bigint, retention_pct numeric)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from user_settings where user_id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;

  return query
  with cohorts as (
    select u.id as user_id, date_trunc('week', u.created_at)::date as cohort_week
    from auth.users u
    left join user_settings s on s.user_id = u.id
    where u.created_at >= now() - (p_weeks || ' weeks')::interval
      and not coalesce(s.excluded_from_analytics, false)
      and not coalesce(u.email ~* '@[^@]+\.(test|invalid|example|localhost)$', false)
  ),
  active_weeks as (
    select distinct user_id, date_trunc('week', created_at)::date as active_week
    from analytics_events
  )
  select
    c.cohort_week,
    count(distinct c.user_id) as cohort_size,
    count(distinct case when aw.active_week = c.cohort_week + interval '7 day' then c.user_id end) as retained_next_week,
    round(
      count(distinct case when aw.active_week = c.cohort_week + interval '7 day' then c.user_id end)::numeric
      / nullif(count(distinct c.user_id), 0) * 100, 1
    ) as retention_pct
  from cohorts c
  left join active_weeks aw on aw.user_id = c.user_id
  group by c.cohort_week
  order by c.cohort_week;
end;
$$;

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
    left join user_settings us on us.user_id = u.id
    where not coalesce(us.excluded_from_analytics, false)
      and not coalesce(u.email ~* '@[^@]+\.(test|invalid|example|localhost)$', false)
    group by 1
  )
  select d.day, coalesce(v.views, 0), coalesce(s.signups, 0)
  from days d
  left join v on v.day = d.day
  left join s on s.day = d.day
  order by d.day;
end;
$$;

-- admin_user_directory: same coalesce on the inverse expression, so an
-- emailless account reports `excluded = false` rather than NULL and the
-- directory agrees with the aggregates above.
create or replace function admin_user_directory()
returns table (
  id uuid,
  email text,
  signed_up_at timestamptz,
  plan text,
  admin boolean,
  excluded boolean,
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
    coalesce(s.excluded_from_analytics, false)
      or coalesce(u.email ~* '@[^@]+\.(test|invalid|example|localhost)$', false),
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

-- Self-records per the convention in 0040_schema_migrations.sql.
insert into schema_migrations (filename)
values ('0046_restore_grants_and_null_email.sql')
on conflict do nothing;

-- ===== 0047_ai_chat.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. There is no Supabase CLI / service-role migration runner in this
-- project, so migrations are never applied automatically.
--
-- Persistent AI conversations for /ask (Phase 1 of the chatbot rebuild).
--
-- Until now a conversation lived only in React state: gone on refresh, and
-- the browser re-sent the whole history with every question. Two tables
-- replace that. Conversation state now lives HERE, and the browser sends only
-- the new message -- the transcript the model sees is built exclusively from
-- rows this server wrote. That is a trust boundary, not a convenience: a
-- client that could replay history could also forge a tool message claiming
-- a trade had been logged, and the model would ground on it.
--
-- Pattern copied from ai_reviews (0032): uuid pk, user_id cascade, owner
-- policy, composite index leading user_id, self-record at the end.

create table ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Null until set; the app derives one from the first message.
  title text,
  -- Plain text validated in the app against AI_PROVIDERS. Deliberately NOT
  -- a CHECK constraint: ai_reviews still carries 0032's six-provider check
  -- that 0041 never widened, so a review through a newer provider fails on
  -- insert. This table does not repeat that mistake.
  provider text not null,
  model text not null,
  -- Which stored key this conversation uses. Set null rather than cascade:
  -- deleting a key must not erase the conversations it answered.
  key_id uuid references user_api_keys(id) on delete set null,
  message_count integer not null default 0,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger ai_conversations_set_updated_at
  before update on ai_conversations
  for each row execute function set_updated_at();

-- The list view: this user's conversations, most recently active first.
create index ai_conversations_user_recent_idx
  on ai_conversations (user_id, last_message_at desc);

alter table ai_conversations enable row level security;

create policy "ai_conversations owner access"
  on ai_conversations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


create table ai_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references ai_conversations(id) on delete cascade,
  -- Dense ordinal within the conversation; the app allocates max + 1.
  seq integer not null,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null default '',
  -- assistant rows: the ToolCall[] the model asked for, echoed back verbatim
  -- on the next turn so every provider's own bookkeeping pairs up.
  tool_calls jsonb,
  -- tool rows: which call this answers (OpenAI/Anthropic pair by id) and
  -- its name (Google pairs by name).
  tool_call_id text,
  tool_name text,
  -- Structured extras: image references and proposal outcomes in later
  -- phases. Never base64 image data -- that is rehydrated per turn and goes
  -- only to the model.
  parts jsonb,
  -- 'interrupted' = the user pressed Stop or the platform cut the request;
  -- the partial text is kept but never presented as a finished answer.
  status text not null default 'complete' check (status in ('complete', 'interrupted', 'error')),
  -- Filled only when the provider reports usage.
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);

-- (conversation_id, seq) unique does double duty: ordering, and single-flight
-- per conversation for free. Two turns racing on the same conversation both
-- allocate the same next seq; the second insert hits 23505 and the route
-- reports "conversation busy" instead of interleaving two model calls.
create unique index ai_messages_conv_seq_idx
  on ai_messages (conversation_id, seq);

-- A tool call is answered at most once. This is what makes re-entry safe:
-- if a turn ran out of time after the model asked for tools but before they
-- ran, the next turn executes them, and a retry of THAT cannot double-insert.
create unique index ai_messages_tool_call_idx
  on ai_messages (conversation_id, tool_call_id)
  where tool_call_id is not null;

create index ai_messages_user_conv_idx
  on ai_messages (user_id, conversation_id, seq);

alter table ai_messages enable row level security;

create policy "ai_messages owner access"
  on ai_messages for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- Consent gains a scope. The chat discloses materially more than the
-- original per-question journal dump did -- persisted conversations, live
-- lookups across every table, screenshots on capable providers, proposed
-- writes -- so consent given for the old shape does not cover the new one.
-- Existing rows default to 'journal_v1' and keep working for the AI-review
-- routes; the chat requires a 'chat_v2' row, so each user re-consents once
-- with the new wording in front of them.
alter table ai_provider_consents
  add column if not exists scope text not null default 'journal_v1';

-- The primary key was (user_id, provider); a user now needs one row per
-- scope per provider, so the key widens. Existing rows keep their default.
alter table ai_provider_consents drop constraint if exists ai_provider_consents_pkey;
alter table ai_provider_consents add primary key (user_id, provider, scope);


-- Self-records per the convention in 0040_schema_migrations.sql.
insert into schema_migrations (filename)
values ('0047_ai_chat.sql')
on conflict do nothing;

-- ===== 0048_chat_hardening.sql =====
-- 0048: two hardening changes for the chat found in an offensive review.
--
-- 1. ai_messages rows must belong to a conversation the SAME user owns.
--
-- 0047's policy checked only `user_id = auth.uid()`. That is enough to stop
-- anyone READING another user's rows, but not INSERTING into another user's
-- conversation: a foreign-key check runs as the table owner and bypasses
-- RLS, so `insert into ai_messages (user_id = me, conversation_id = <yours>)`
-- succeeded for anyone holding a session and your conversation's UUID --
-- which is in the /ask?c= URL. The app then read your conversation's rows by
-- conversation_id alone, so the attacker's rows entered YOUR model
-- transcript: prompt injection into someone else's chat. The routes were
-- never the boundary here; every signed-in user can call PostgREST directly
-- with the anon key and their JWT.
--
-- 2. A per-conversation turn claim, so two model calls can never run at
--    once on one conversation.
--
-- The unique (conversation_id, seq) index serialises the INSERT of the
-- assistant row, not the model call that follows it; a second request that
-- arrived during a 20-second stream saw no collision and started its own
-- call. `turn_started_at` is claimed with a conditional update (null, or
-- older than the turn budget) and cleared when the turn ends.

drop policy if exists "ai_messages owner access" on ai_messages;

create policy "ai_messages owner access"
  on ai_messages for all
  using (
    auth.uid() = user_id
    and exists (
      select 1 from ai_conversations c
      where c.id = ai_messages.conversation_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from ai_conversations c
      where c.id = ai_messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

alter table ai_conversations
  add column if not exists turn_started_at timestamptz;

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0048_chat_hardening.sql')
on conflict do nothing;

-- ===== 0049_paid_tour_offer_state.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
--
-- Where the paid-plan tour offer's dismissal lives.
--
-- The offer ("Everything just unlocked -- a 10-step tour") was stored in
-- localStorage under `tl-paid-tour-offered`, which meant two things. It was
-- per browser, so the same account met it again on a second device after
-- having already said no. And it had one state, dismissed-forever, so
-- "Later" and "Show me" did the same thing -- there was no way to say "not
-- now" and mean it.
--
-- Two columns rather than one, because they are two different facts:
--
--   paid_tour_dismissed       the offer is finished with. Set by "Show me"
--                             and by completing the tour. Never unset.
--   paid_tour_snoozed_until   "Later": hidden until this moment passes.
--                             Null when never snoozed.
--
-- A single nullable timestamptz could encode both with 'infinity', which is
-- shorter and worse: every reader would have to know that convention, and a
-- query for "who is still snoozed" would silently include the people who are
-- done.

alter table user_settings
  add column if not exists paid_tour_dismissed boolean not null default false;

alter table user_settings
  add column if not exists paid_tour_snoozed_until timestamptz;

-- REQUIRED, not optional. 0024_user_settings_column_grants.sql revoked blanket
-- insert/update on this table and re-granted it column by column, because RLS
-- cannot express "you may write your own row but not its is_admin column". A
-- column added after that migration has no grant at all, so writing it fails
-- with "permission denied for table user_settings" -- and the failure is a
-- silent no-op in the UI, not an error anyone sees.
--
-- Anything that adds a user-writable column to this table must come back
-- here. is_admin and excluded_from_analytics stay off both lists deliberately.
grant insert (paid_tour_dismissed, paid_tour_snoozed_until)
  on user_settings to authenticated;

grant update (paid_tour_dismissed, paid_tour_snoozed_until)
  on user_settings to authenticated;

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0049_paid_tour_offer_state.sql')
on conflict do nothing;

-- ===== 0050_waitlist.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
--
-- The paid-plan waitlist (Phase 2B of docs/design-audit.md). The paid plan is
-- not on sale; this is where a visitor leaves an email to hear when it is.
-- Nothing reads this table from the app. Alon exports it from the Supabase
-- dashboard, and no email is sent by the app.
--
-- WHO CAN TOUCH IT: only the service role. RLS is on with NO policies, which
-- denies anon and authenticated everything, and the grants are revoked as a
-- second lock -- a policy added by mistake later would still find no grant to
-- act on. The only writer is POST /api/waitlist (src/app/api/waitlist/
-- route.ts), which validates, rate limits, and inserts with the service-role
-- key. Reading happens only in the dashboard.
--
-- THE LIST IS NOT DISCOVERABLE. The unique index is on lower(email) so the
-- same address in different case is one row, and the route answers a
-- duplicate exactly as it answers a new signup, so the endpoint cannot be used
-- to test whether someone is on the list.

create table if not exists waitlist (
  id uuid primary key default gen_random_uuid(),
  -- 254 is the longest a valid address can be (RFC 5321's path limit, minus
  -- the angle brackets). The route rejects longer ones first; this is the
  -- floor under it.
  email text not null check (length(email) <= 254),
  -- Which form it came from, from a fixed allowlist the route enforces
  -- (src/lib/waitlist/validate.ts). Null only if a future form omits it.
  source text,
  created_at timestamptz not null default now()
);

create unique index if not exists waitlist_email_lower_key on waitlist (lower(email));

alter table waitlist enable row level security;

revoke all on table waitlist from anon, authenticated;

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0050_waitlist.sql')
on conflict do nothing;

-- ===== 0051_demo_journal.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
--
-- The optional demo journal for new accounts (Phase 4D of
-- docs/design-audit.md, in the shape Alon chose on 2026-09-28):
--
--   * Before the first tour, once: "Start with a demo journal?"
--   * No  -> an empty journal, and the demo is never offered again.
--   * Yes -> the account is filled with a demo journal, an editable sandbox.
--            A one-time "Switch to my own journal" clears it for good.
--
-- The demo and the real journal never exist at the same time, so no query
-- anywhere needs to tell them apart, and demo figures can't mix into real
-- ones.
--
-- demo_state on user_settings:
--   null       not asked yet
--   declined   said no; never offered again
--   active     the demo journal is in the account
--   done       switched to their own journal; never offered again
--
-- NO column grant, on purpose (see 0024: this table is granted column by
-- column). The only way to change demo_state is through the three functions
-- below, which is what makes "never again" hold -- a user can't reset it to
-- null from the browser to re-seed, or skip straight to done.

alter table user_settings
  add column if not exists demo_state text
    check (demo_state in ('declined', 'active', 'done'));

-- Existing accounts are past their first login: nobody who already has a
-- trade or has finished the tour is asked. Only rows still null are touched,
-- so re-running this file changes nothing.
update user_settings us
set demo_state = 'declined'
where us.demo_state is null
  and (
    us.has_completed_tour
    or exists (select 1 from trades t where t.user_id = us.user_id)
  );

-- ---- seed_demo_journal ------------------------------------------------------
--
-- Inserts the demo journal the app sends (src/lib/demo/payload.ts builds it
-- from src/lib/demo/journal.json) and marks the account active, in ONE
-- transaction: a failure part-way leaves nothing behind and the question
-- still unanswered.
--
-- SECURITY DEFINER so it can set demo_state, which the user can't. Every row
-- it writes is forced to auth.uid(); nothing in the payload can name another
-- user. Trade rows are inserted column by column from the keys the payload
-- actually carries, so columns it omits take their table defaults -- a column
-- added by a later migration can't break the seed by arriving as null.
create or replace function seed_demo_journal(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  s jsonb;
  r jsonb;
  t jsonb;
  h jsonb;
  sid uuid;
  tid uuid;
  skey text;
  strategy_ids jsonb := '{}'::jsonb;
  cols text;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  insert into user_settings (user_id) values (uid) on conflict (user_id) do nothing;
  perform 1 from user_settings where user_id = uid and demo_state is null for update;
  if not found then
    raise exception 'demo journal not available' using errcode = 'P0001', hint = 'demo_answered';
  end if;
  if exists (select 1 from trades where user_id = uid) then
    raise exception 'journal not empty' using errcode = 'P0001', hint = 'journal_not_empty';
  end if;

  for s in select * from jsonb_array_elements(coalesce(payload->'strategies', '[]'::jsonb)) loop
    insert into strategies (user_id, name, description, color, sort_order)
    values (uid, s->>'name', s->>'description', s->>'color', coalesce((s->>'sort_order')::int, 0))
    on conflict (user_id, name) do update set name = excluded.name
    returning id into sid;
    strategy_ids := strategy_ids || jsonb_build_object(s->>'key', sid);

    for r in select * from jsonb_array_elements(coalesce(s->'rules', '[]'::jsonb)) loop
      insert into strategy_rules (
        user_id, strategy_id, label, subject_source, subject_key, operator,
        number_value, number_value_max, text_value, enabled, sort_order
      ) values (
        uid, sid, r->>'label', r->>'subject_source', r->>'subject_key', r->>'operator',
        (r->>'number_value')::numeric, (r->>'number_value_max')::numeric, r->>'text_value',
        true, coalesce((r->>'sort_order')::int, 0)
      );
    end loop;
  end loop;

  for t in select * from jsonb_array_elements(coalesce(payload->'trades', '[]'::jsonb)) loop
    select string_agg(quote_ident(k), ', ')
      into cols
      from jsonb_object_keys(t->'row') as k
      where k not in ('id', 'user_id')
        and exists (
          select 1 from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = 'trades' and c.column_name = k
        );

    execute format(
      'insert into trades (user_id, %1$s) select $1, %1$s from jsonb_populate_record(null::trades, $2) returning id',
      cols
    ) using uid, t->'row' into tid;

    for skey in select * from jsonb_array_elements_text(coalesce(t->'strategies', '[]'::jsonb)) loop
      if strategy_ids ? skey then
        insert into trade_strategies (trade_id, strategy_id)
        values (tid, (strategy_ids->>skey)::uuid)
        on conflict do nothing;
      end if;
    end loop;

    -- Pre-edit snapshots, for the few trades whose stop was moved: that is
    -- only visible in edit history (0008), so the demo writes it directly.
    for h in select * from jsonb_array_elements(coalesce(t->'history', '[]'::jsonb)) loop
      insert into trade_history (trade_id, user_id, snapshot, created_at)
      values (
        tid,
        uid,
        (h->'snapshot') || jsonb_build_object('id', tid, 'user_id', uid),
        coalesce((h->>'created_at')::timestamptz, now())
      );
    end loop;
  end loop;

  if payload ? 'deposit' then
    insert into account_transactions (user_id, amount, note, created_at)
    values (
      uid,
      (payload->'deposit'->>'amount')::numeric,
      payload->'deposit'->>'note',
      coalesce((payload->'deposit'->>'created_at')::timestamptz, now())
    );
  end if;

  update user_settings set demo_state = 'active' where user_id = uid;
end;
$$;

-- ---- finish_demo_journal ------------------------------------------------------
--
-- "Switch to my own journal": clears the journal and marks the demo done, in
-- one transaction. Everything the user added while trying the demo goes too
-- -- the app says so before they confirm. Account setup stays: settings,
-- AI keys and consents, commission rules, and the default fields (only
-- non-default field definitions are removed).
--
-- Screenshot FILES live in Storage, which SQL shouldn't reach into; the app
-- removes them after this succeeds (src/app/api/demo/route.ts). Their rows go
-- with the trades here.
create or replace function finish_demo_journal()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform 1 from user_settings where user_id = uid and demo_state = 'active' for update;
  if not found then
    raise exception 'no demo journal to finish' using errcode = 'P0001', hint = 'demo_not_active';
  end if;

  -- ai_messages cascade from ai_conversations; trade_history, trade_images,
  -- trade_strategies, trade_folders, trade_excursions and trade reviews
  -- cascade from trades.
  delete from ai_conversations where user_id = uid;
  delete from ai_reviews where user_id = uid;
  delete from trades where user_id = uid;
  delete from strategy_rules where user_id = uid;
  delete from strategies where user_id = uid;
  delete from folders where user_id = uid;
  delete from goals where user_id = uid;
  delete from account_transactions where user_id = uid;
  delete from field_definitions where user_id = uid and not is_default;

  update user_settings set demo_state = 'done' where user_id = uid;
end;
$$;

-- ---- decline_demo_journal -----------------------------------------------------
create or replace function decline_demo_journal()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  insert into user_settings (user_id) values (uid) on conflict (user_id) do nothing;
  update user_settings set demo_state = 'declined' where user_id = uid and demo_state is null;
  if not found then
    raise exception 'demo journal already answered' using errcode = 'P0001', hint = 'demo_answered';
  end if;
end;
$$;

-- Signed-in users only. Functions are executable by PUBLIC by default.
revoke execute on function seed_demo_journal(jsonb) from public, anon;
revoke execute on function finish_demo_journal() from public, anon;
revoke execute on function decline_demo_journal() from public, anon;
grant execute on function seed_demo_journal(jsonb) to authenticated;
grant execute on function finish_demo_journal() to authenticated;
grant execute on function decline_demo_journal() to authenticated;

-- New functions are callable through PostgREST only once its schema cache
-- sees them; Supabase usually reloads on DDL, this makes it certain.
notify pgrst, 'reload schema';

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0051_demo_journal.sql')
on conflict do nothing;

-- ===== 0052_trade_summary_preference.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
--
-- A switch for the summary strip above the trade list (Phase 4B). Alon,
-- 2026-09-29: useful, but some traders would rather not see running figures
-- while they work through their list, so Setup -> Settings can turn it off.
-- On by default, so nothing changes for anyone until they choose.

alter table user_settings
  add column if not exists show_trade_summary boolean not null default true;

-- REQUIRED, not optional: 0024 grants this table column by column, so a new
-- user-writable column needs its own grant or writes fail as "permission
-- denied" (see the note in 0049).
grant insert (show_trade_summary) on user_settings to authenticated;
grant update (show_trade_summary) on user_settings to authenticated;

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0052_trade_summary_preference.sql')
on conflict do nothing;

-- ===== 0053_ai_key_model.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
--
-- Which model each saved AI key asks.
--
-- Until now every key of a provider asked the one model hard-coded in
-- src/lib/ai-keys/types.ts, and providers retire models on their own
-- schedule: Cerebras' llama-3.3-70b and Google's gemini-2.0-flash both died
-- that way, taking Ask down for anyone on those keys. Now the app picks the
-- first of its preferred models that the provider's live list still offers,
-- stores it here, and re-picks when it disappears. The user can also choose
-- one from that list.
--
-- Null = not chosen yet (keys saved before this); the app then uses its
-- first choice for the provider, exactly as before. Nothing breaks while this
-- is unapplied -- the key queries fall back to selecting without the column.

alter table user_api_keys
  add column if not exists model text
    check (model is null or (length(model) between 1 and 200));

-- No grant needed: user_api_keys has no column-level grants (unlike
-- user_settings, see 0024), and 0029's owner-only RLS policy covers the new
-- column like every other.

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0053_ai_key_model.sql')
on conflict do nothing;

-- ===== 0054_user_preferences.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
--
-- One home for Setup -> Settings switches (Alon, 2026-09-29): trade preview
-- panel, keyboard shortcuts, theme, tour offers, card hover motion.
--
-- A jsonb object rather than a column per switch: 0052 showed that each new
-- boolean column costs a migration, two grants and a missing-column fallback,
-- and the switch list is meant to grow. The app validates the object with one
-- zod schema (src/lib/settings/preferences.ts) on every read and write, and
-- reads anything it doesn't recognise as the default -- so a hand-edited or
-- stale value can never break a page, only fall back.
--
-- show_trade_summary (0052) stays its own column; nothing moves.

alter table user_settings
  add column if not exists preferences jsonb not null default '{}'::jsonb;

-- The row is user-writable (below), so bound what can be put in it. Only an
-- object, and small: every real value is a handful of booleans.
alter table user_settings
  drop constraint if exists user_settings_preferences_shape;
alter table user_settings
  add constraint user_settings_preferences_shape
    check (jsonb_typeof(preferences) = 'object' and pg_column_size(preferences) <= 4096);

-- REQUIRED, not optional: 0024 grants this table column by column, so a new
-- user-writable column needs its own grant or writes fail as "permission
-- denied" (see the note in 0049).
grant insert (preferences) on user_settings to authenticated;
grant update (preferences) on user_settings to authenticated;

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0054_user_preferences.sql')
on conflict do nothing;

-- ===== 0055_commission_components.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
--
-- Multi-line commission rules and broker presets (Alon, 2026-09-29).
--
-- A 0022 rule is ONE fee line (flat, percent or per share, with a min/max).
-- Real brokers charge several at once: IBKR Pro Fixed is $0.005/share with a
-- $1 minimum and a 1%-of-value cap, PLUS the SEC fee and FINRA's TAF on sells.
-- `components` holds those lines; when it is a non-empty array the app uses
-- it instead of rule_type/amount/applies_to/min_fee/max_fee, which keep
-- describing every existing single-line rule exactly as before.
--
-- The app validates the array with zod (src/lib/commissions/schema.ts) on
-- every write. `preset_id` records which researched broker preset a rule came
-- from (src/lib/commissions/presets.ts), so the UI can show its source and
-- the date its figures were checked.

alter table commission_rules
  add column if not exists components jsonb,
  add column if not exists preset_id text;

-- Bound what can be stored: null, or an array of at most 8 lines, small.
alter table commission_rules
  drop constraint if exists commission_rules_components_shape;
alter table commission_rules
  add constraint commission_rules_components_shape
    check (
      components is null
      or (jsonb_typeof(components) = 'array'
          and jsonb_array_length(components) <= 8
          and pg_column_size(components) <= 8192)
    );

alter table commission_rules
  drop constraint if exists commission_rules_preset_id_length;
alter table commission_rules
  add constraint commission_rules_preset_id_length
    check (preset_id is null or length(preset_id) <= 80);

-- No grant needed: commission_rules has no column-level grants (unlike
-- user_settings, see 0024); 0022's owner-only RLS policy covers these too.

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0055_commission_components.sql')
on conflict do nothing;

-- ===== 0056_trade_commission_rule.sql =====
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

-- ===== 0057_monthly_costs.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
--
-- Monthly costs (Alon, 2026-09-29): platform, data or account fees charged
-- per month rather than per trade. Each month one is due, it is taken from
-- the user's cash as a withdrawal in account_transactions (0016) -- the same
-- ledger deposits and withdrawals live in, so the balance, available cash
-- and position-size prefill all see it with no other change.

create table if not exists monthly_costs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  -- In `currency` (null = the account's own), converted at `fx_rate`.
  amount numeric not null check (amount > 0 and amount < 10000000),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  fx_rate numeric check (fx_rate is null or (fx_rate > 0 and fx_rate < 100000)),
  -- 1-28, so every month has the day.
  day_of_month int not null default 1 check (day_of_month between 1 and 28),
  starts_on date not null default current_date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (currency is null or fx_rate is not null)
);

create index if not exists monthly_costs_user_idx on monthly_costs (user_id);

create trigger monthly_costs_set_updated_at
  before update on monthly_costs
  for each row execute function set_updated_at();

alter table monthly_costs enable row level security;

create policy "monthly_costs owner access"
  on monthly_costs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- One row per cost per month taken. The primary key is what makes taking a
-- month idempotent: two page loads racing to take September both try to
-- insert (cost, 2026-09-01); one wins, the other skips. Deleting a cost
-- removes these rows but not the withdrawals -- money already taken stays
-- in the ledger, where the user can delete it like any other entry.
create table if not exists monthly_cost_postings (
  cost_id uuid not null references monthly_costs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  transaction_id uuid references account_transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (cost_id, month)
);

alter table monthly_cost_postings enable row level security;

create policy "monthly_cost_postings owner access"
  on monthly_cost_postings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0057_monthly_costs.sql')
on conflict do nothing;

-- ===== 0058_lock_down_api_keys.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
--
-- Lock down users' AI provider keys (security pass, 2026-09-30).
--
-- Until now `user_api_keys` kept Supabase's default table-wide grants for
-- the `authenticated` role, bounded only by the owner RLS policy (0029). RLS
-- limits WHICH ROWS a user touches, not WHICH COLUMNS -- so a stolen session
-- or an XSS, acting with the user's own JWT straight against PostgREST, could:
--   * read the ciphertext of every key the user has,
--   * change a key's `provider`, sending the key to a different provider's
--     servers the next time it is used,
--   * insert keys, skipping the 10-key cap and the provider check.
-- (user_settings got column-level grants for exactly this reason in 0024.)
--
-- After this, the `authenticated` role can only see a key's PUBLIC columns
-- and change its label / on-off state or delete it. Storing a key, reading
-- its ciphertext and recording its model happen server-side only, through
-- src/lib/ai-keys/vault.ts with the service-role key, filtered by the user
-- id of the verified session.
--
-- ORDER MATTERS: apply this only AFTER the code with vault.ts is deployed.
-- Older code inserts and decrypts keys through the user's own session, which
-- this migration forbids -- applied first, the live site could no longer
-- save or use keys. (The new code works with or without it.)

-- When the key was last sent to its provider: shown to the user, so use they
-- didn't make stands out.
alter table user_api_keys add column if not exists last_used_at timestamptz;

-- The model id ends up in a provider URL (Google). Only the characters the
-- API accepts; 0053's check only bounded the length.
alter table user_api_keys drop constraint if exists user_api_keys_model_chars;
alter table user_api_keys
  add constraint user_api_keys_model_chars
    check (model is null or model ~ '^[A-Za-z0-9_.:/@-]{1,200}$');

-- Column-level privileges. REVOKE first: a column grant does not remove a
-- table-wide one, and the table-wide one is what has to go.
revoke all on user_api_keys from anon;
revoke all on user_api_keys from authenticated;

grant select (
  id, user_id, provider, label, last_four, is_active, model,
  created_at, updated_at, last_validated_at, last_used_at
) on user_api_keys to authenticated;
grant update (label, is_active) on user_api_keys to authenticated;
grant delete on user_api_keys to authenticated;
-- No INSERT, and no SELECT/UPDATE on encrypted_key, provider, model or
-- user_id: those go through the service role only.

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0058_lock_down_api_keys.sql')
on conflict do nothing;

-- ===== 0059_fk_owner_checks.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
-- Safe to apply at any time: it only adds checks on future inserts/updates,
-- and every row the app writes already points at the writer's own records.
--
-- Cross-user foreign keys (security hardening, Phase 1, 2026-10-09).
--
-- A foreign key check runs with RLS bypassed. So a policy that only checks
-- the row's own user_id (`auth.uid() = user_id`) still lets a signed-in user,
-- calling PostgREST directly with their own token, write a row of their own
-- that POINTS AT another user's record. The 2026-09-21 ai_messages hole
-- (0048) and the commission-rule backstop (0056) were two cases of this;
-- these are the remaining eight:
--
--   trade_history.trade_id            trade_images.trade_id
--   ai_reviews.trade_id               trade_excursions.trade_id
--   strategy_rules.strategy_id        field_definitions.strategy_id
--   ai_conversations.key_id           monthly_cost_postings.cost_id / transaction_id
--
-- Exploiting any of them needs the other user's record UUID (random v4, never
-- shown across accounts), so none leaks data. Two could interfere with the
-- other user, because the foreign key is part of the primary key: a foreign
-- row in trade_excursions (pk trade_id) or monthly_cost_postings
-- (pk cost_id, month) would take the slot the real owner later needs, and
-- the owner cannot see or delete it.
--
-- One generic trigger function instead of eight copies of 0056: the
-- referenced table and column come from the trigger arguments. It runs only
-- when the foreign key column is written (`update of <col>`), and an
-- `on delete set null` cascade writes null, which passes straight through.
-- Error code 42501 makes PostgREST answer 403, the same as an RLS refusal.

create or replace function enforce_fk_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ref_table text := tg_argv[0];
  fk_col text := tg_argv[1];
  ref_id uuid;
  owned boolean;
begin
  ref_id := (to_jsonb(new) ->> fk_col)::uuid;
  if ref_id is null then
    return new;
  end if;
  execute format('select exists (select 1 from %I where id = $1 and user_id = $2)', ref_table)
    into owned
    using ref_id, new.user_id;
  if not owned then
    raise exception using
      errcode = '42501',
      message = format('%s.%s must point at one of your own %s', tg_table_name, fk_col, ref_table);
  end if;
  return new;
end;
$$;

-- Trigger functions cannot be called directly, but keep the grant surface
-- minimal anyway.
revoke all on function enforce_fk_owner() from public, anon, authenticated;

drop trigger if exists trade_history_trade_owner on trade_history;
create trigger trade_history_trade_owner
  before insert or update of trade_id on trade_history
  for each row execute function enforce_fk_owner('trades', 'trade_id');

drop trigger if exists trade_images_trade_owner on trade_images;
create trigger trade_images_trade_owner
  before insert or update of trade_id on trade_images
  for each row execute function enforce_fk_owner('trades', 'trade_id');

drop trigger if exists ai_reviews_trade_owner on ai_reviews;
create trigger ai_reviews_trade_owner
  before insert or update of trade_id on ai_reviews
  for each row execute function enforce_fk_owner('trades', 'trade_id');

drop trigger if exists trade_excursions_trade_owner on trade_excursions;
create trigger trade_excursions_trade_owner
  before insert or update of trade_id on trade_excursions
  for each row execute function enforce_fk_owner('trades', 'trade_id');

drop trigger if exists strategy_rules_strategy_owner on strategy_rules;
create trigger strategy_rules_strategy_owner
  before insert or update of strategy_id on strategy_rules
  for each row execute function enforce_fk_owner('strategies', 'strategy_id');

drop trigger if exists field_definitions_strategy_owner on field_definitions;
create trigger field_definitions_strategy_owner
  before insert or update of strategy_id on field_definitions
  for each row execute function enforce_fk_owner('strategies', 'strategy_id');

drop trigger if exists ai_conversations_key_owner on ai_conversations;
create trigger ai_conversations_key_owner
  before insert or update of key_id on ai_conversations
  for each row execute function enforce_fk_owner('user_api_keys', 'key_id');

drop trigger if exists monthly_cost_postings_cost_owner on monthly_cost_postings;
create trigger monthly_cost_postings_cost_owner
  before insert or update of cost_id on monthly_cost_postings
  for each row execute function enforce_fk_owner('monthly_costs', 'cost_id');

drop trigger if exists monthly_cost_postings_transaction_owner on monthly_cost_postings;
create trigger monthly_cost_postings_transaction_owner
  before insert or update of transaction_id on monthly_cost_postings
  for each row execute function enforce_fk_owner('account_transactions', 'transaction_id');

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0059_fk_owner_checks.sql')
on conflict do nothing;

-- Check after applying (expect 9 rows):
--   select distinct event_object_table, trigger_name from information_schema.triggers
--   where action_statement like '%enforce_fk_owner%' order by 1, 2;

-- ===== 0060_trade_images_bucket_limits.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
-- Safe to apply at any time: it only narrows what the storage API accepts
-- into the trade-images bucket, and the app never uploads anything outside
-- these limits.
--
-- Upload limits enforced by Storage itself (security hardening, Phase 4).
--
-- The upload route (src/app/api/trades/[id]/images/route.ts) checks type,
-- real image bytes, 5 MB and 50 megapixels, and re-encodes the image. But
-- the bucket had no limits of its own, and its policies (0012) let a signed-
-- in user write into their own folder directly through the Storage API with
-- their own token -- skipping the route and every check in it. So any file,
-- of any type and size, could be stored under the user's own prefix.
--
-- These limits apply to every upload into the bucket, whatever the path:
--   * 10 MB: the route caps input at 5 MB, but re-encoding (sharp) can grow
--     a heavily compressed image a little; 10 MB keeps the app's own uploads
--     well inside while still bounding a direct one.
--   * the four image types the route accepts. Storage checks the declared
--     content type here; the route additionally checks the actual bytes.
--     Not SVG -- the reason the route rejects it is that it can carry script.

update storage.buckets
set file_size_limit = 10 * 1024 * 1024,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'trade-images';

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0060_trade_images_bucket_limits.sql')
on conflict do nothing;

-- Check after applying:
--   select id, file_size_limit, allowed_mime_types from storage.buckets where id = 'trade-images';

-- ===== 0061_signup_consent.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
-- Safe to apply before or after the code: until the new sign-up form sends
-- the flags, new accounts simply get nulls, exactly like existing ones.
--
-- Records that a new account confirmed being 18+ and accepted the Terms and
-- Privacy Policy (security hardening, Part B, 2026-10-09).
--
-- The sign-up form now has a required checkbox. Ticking it sends two flags in
-- the sign-up metadata. This trigger copies them into user_settings with the
-- DATABASE's own clock, so the record says when the account was created
-- with that agreement and cannot be back-dated from the browser.
--
-- The columns get NO write grant for `authenticated` (user_settings is
-- granted column by column since 0024), so a user cannot change or clear
-- their own record afterwards. Only this trigger and the service role write
-- them.
--
-- Existing accounts stay null: they signed up before the checkbox existed
-- ("pre-consent"), under the passive "By creating an account you agree"
-- wording. Accounts made by the service role (seed scripts, e2e, the demo
-- account) send no flags and also stay null.

alter table user_settings
  add column if not exists age_confirmed_at timestamptz,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text check (terms_version is null or length(terms_version) <= 40);

create or replace function seed_user_settings()
returns trigger as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  version text := left(meta->>'accepted_terms_version', 40);
begin
  insert into public.user_settings (user_id, age_confirmed_at, terms_accepted_at, terms_version)
  values (
    new.id,
    case when meta->>'age_confirmed' = 'true' then now() end,
    case when version is not null and version <> '' then now() end,
    nullif(version, '')
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- The trigger itself (0003, on_auth_user_created_seed_settings) is unchanged;
-- `create or replace function` is picked up by it.

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0061_signup_consent.sql')
on conflict do nothing;

-- Check after applying (new sign-ups only):
--   select user_id, age_confirmed_at, terms_accepted_at, terms_version
--   from user_settings order by created_at desc limit 5;

-- ===== 0062_admin_activity.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
-- Safe to apply before the code: it only adds a function and two indexes.
--
-- The admin Activity tab (Problem 1 of the hardening brief, 2026-10-09).
--
-- One security-definer function returns raw events in a time window, with
-- the account's email and whether it is excluded from analytics, for all
-- users or one. The app turns them into readable sentences, sessions and
-- "where users leave" (src/lib/tracking/activity.ts). Grouping and wording
-- live in TypeScript, next to the event list (src/lib/tracking/events.ts),
-- rather than in SQL here, so there is one place that knows what an event
-- means.
--
-- Admin-only: the function checks is_admin itself, like every admin_*
-- function since 0013. It returns the same metadata admin_user_detail (0043)
-- already returns for one user (paths, button names, ids, counts), never
-- trade contents.

-- The window scan and the per-session grouping.
create index if not exists analytics_events_created_desc_idx on analytics_events (created_at desc);
create index if not exists analytics_events_user_created_idx on analytics_events (user_id, created_at desc);

create or replace function admin_activity(
  p_days int default 7,
  p_user_id uuid default null,
  p_limit int default 5000
)
returns table (
  created_at timestamptz,
  user_id uuid,
  email text,
  excluded boolean,
  session_id text,
  event_name text,
  event_props jsonb
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
    e.created_at,
    e.user_id,
    u.email::text,
    coalesce(s.excluded_from_analytics, false)
      or coalesce(u.email ~* '@[^@]+\.(test|invalid|example|localhost)$', false),
    e.session_id,
    e.event_name,
    coalesce(e.event_props, '{}'::jsonb)
  from analytics_events e
  left join auth.users u on u.id = e.user_id
  left join user_settings s on s.user_id = e.user_id
  where e.created_at >= now() - make_interval(days => greatest(1, least(p_days, 365)))
    and (p_user_id is null or e.user_id = p_user_id)
  order by e.created_at desc
  limit greatest(1, least(p_limit, 20000));
end;
$$;

revoke all on function admin_activity(int, uuid, int) from public;
grant execute on function admin_activity(int, uuid, int) to authenticated;

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0062_admin_activity.sql')
on conflict do nothing;

-- ===== 0063_fill_price_check.sql =====
-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
-- Safe to apply before or after the code: the app only reads these columns
-- when they exist, and nothing sets them except the trigger below and the
-- user answering the question.
--
-- "At what price did it fill?" (Alon, 2026-10-10).
--
-- When a resting order fills, the app has to assume the price: a stop at its
-- stop, a limit at its limit, a stop-limit at its limit (auto-execute.ts).
-- Real fills often differ -- a stop slips through its level on a gap, a
-- stop-limit can fill anywhere between its two prices -- and the entry price
-- drives every P/L and R figure in the app. So the trade card asks.
--
-- A trigger rather than app code, so all three ways an order fills ask the
-- same question: the user switching Status by hand, the trade page's live
-- price watch, and the 15-minute background sweep (service role).
--
--   fill_price_confirmed  null  = nothing to ask (every existing trade, and
--                                 market orders, which fill at the market)
--                         false = ask on the trade card
--                         true  = answered
--   order_price           the resting order's own price at the moment it
--                         filled (the stop of a stop-limit, which the fill
--                         itself overwrites with the limit), so the question
--                         can say where the fill should be.

alter table trades
  add column if not exists fill_price_confirmed boolean,
  add column if not exists order_price numeric;

create or replace function flag_fill_to_confirm()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'pending'
     and new.status in ('open', 'closed')
     and new.order_type in ('limit', 'stop', 'stop_limit', 'trailing_stop')
  then
    new.fill_price_confirmed := false;
    new.order_price := old.entry_price;
  elsif new.status = 'pending' and old.status <> 'pending' then
    -- Put back to pending (an undo): nothing has filled, nothing to ask.
    new.fill_price_confirmed := null;
    new.order_price := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trades_flag_fill_to_confirm on trades;
create trigger trades_flag_fill_to_confirm
  before update of status on trades
  for each row
  execute function flag_fill_to_confirm();

comment on column trades.fill_price_confirmed is
  'Null: nothing to ask. False: a resting order filled and the trade card asks for the real fill price. True: answered. Set by flag_fill_to_confirm (0063).';
comment on column trades.order_price is
  'The resting order''s own price when it filled (a stop-limit''s stop), for the fill-price question. Set by flag_fill_to_confirm (0063).';

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0063_fill_price_check.sql')
on conflict do nothing;
