-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it (dev project first, then live). No Supabase CLI in this project.
-- Safe to apply before the code: nothing reads these until it ships.
--
-- Reviews of Trading Lens itself (Alon, 2026-10-11): 1-5 stars and an
-- optional comment, so he can see what to improve and show the best on the
-- homepage. One review per account, editable and removable by its writer.
--
-- Homepage rules (his decisions, and docs/design-audit.md's one rule -- no
-- invented testimonials or scores):
--   * only reviews HE picks (featured), never automatically;
--   * only 4-5 stars WITH a quote, and only if the writer allowed it;
--   * the name shown is the one the writer chose; email never leaves here;
--   * no average or count is published (public_featured_reviews returns
--     rows, not aggregates).

create table if not exists app_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) between 1 and 1000),
  allow_public boolean not null default false,
  display_name text check (display_name is null or char_length(display_name) between 1 and 40),
  source text not null default 'account_menu'
    check (source in ('closed_trades', 'wow_import', 'wow_ai_review', 'two_weeks', 'homepage', 'account_menu')),
  -- Set only by an admin (admin_set_review_featured): no user grant below.
  featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Only a public, 4-5 star review with a quote can ever be on the homepage.
  constraint app_reviews_featured_rule check (not featured or (allow_public and rating >= 4 and comment is not null))
);

alter table app_reviews enable row level security;

drop policy if exists "own review: read" on app_reviews;
create policy "own review: read" on app_reviews for select using (auth.uid() = user_id);
drop policy if exists "own review: write" on app_reviews;
create policy "own review: write" on app_reviews for insert with check (auth.uid() = user_id);
drop policy if exists "own review: edit" on app_reviews;
create policy "own review: edit" on app_reviews for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own review: remove" on app_reviews;
create policy "own review: remove" on app_reviews for delete using (auth.uid() = user_id);

-- Column by column, like user_settings (0024): `featured` has no grant, so a
-- user cannot put their own review on the homepage.
revoke all on app_reviews from anon;
revoke insert, update on app_reviews from authenticated;
grant select, delete on app_reviews to authenticated;
grant insert (user_id, rating, comment, allow_public, display_name, source) on app_reviews to authenticated;
grant update (rating, comment, allow_public, display_name, source) on app_reviews to authenticated;

-- Any edit by the writer takes a review off the homepage until it is picked
-- again: an approved quote can't be edited into something else.
create or replace function app_reviews_on_edit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if (new.rating, new.comment, new.allow_public, new.display_name)
     is distinct from (old.rating, old.comment, old.allow_public, old.display_name) then
    new.featured := false;
  end if;
  return new;
end;
$$;

drop trigger if exists app_reviews_on_edit on app_reviews;
create trigger app_reviews_on_edit
  before update on app_reviews
  for each row
  execute function app_reviews_on_edit();

-- The homepage: picked reviews only, and only what is shown. No email, no
-- user id, no aggregate. Callable without signing in.
create or replace function public_featured_reviews()
returns table (rating smallint, comment text, display_name text, reviewed_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select r.rating, r.comment, r.display_name, r.created_at
  from app_reviews r
  where r.featured and r.allow_public and r.rating >= 4 and r.comment is not null
  order by r.updated_at desc
  limit 12;
$$;

revoke all on function public_featured_reviews() from public;
grant execute on function public_featured_reviews() to anon, authenticated;

-- Admin: every review with its account email, newest first.
create or replace function admin_reviews()
returns table (
  id uuid,
  user_id uuid,
  email text,
  rating smallint,
  comment text,
  allow_public boolean,
  display_name text,
  source text,
  featured boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from user_settings us where us.user_id = auth.uid() and us.is_admin) then
    raise exception 'not authorized';
  end if;
  return query
    select r.id, r.user_id, u.email::text, r.rating, r.comment, r.allow_public, r.display_name,
           r.source, r.featured, r.created_at, r.updated_at
    from app_reviews r
    join auth.users u on u.id = r.user_id
    order by r.created_at desc;
end;
$$;

revoke all on function admin_reviews() from public;
grant execute on function admin_reviews() to authenticated;

create or replace function admin_set_review_featured(p_review_id uuid, p_featured boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from user_settings us where us.user_id = auth.uid() and us.is_admin) then
    raise exception 'not authorized';
  end if;
  -- The check constraint refuses a review that may not be featured.
  update app_reviews set featured = p_featured where id = p_review_id;
end;
$$;

revoke all on function admin_set_review_featured(uuid, boolean) from public;
grant execute on function admin_set_review_featured(uuid, boolean) to authenticated;

-- When to ask (src/lib/reviews/prompt.ts): "Don't ask again", "Not now" (30
-- days) and how many times it has asked (at most 3).
alter table user_settings add column if not exists review_prompt_dismissed boolean not null default false;
alter table user_settings add column if not exists review_prompt_snoozed_until timestamptz;
alter table user_settings add column if not exists review_prompt_count smallint not null default 0;

-- REQUIRED: 0024 grants user_settings column by column.
grant insert (review_prompt_dismissed, review_prompt_snoozed_until, review_prompt_count) on user_settings to authenticated;
grant update (review_prompt_dismissed, review_prompt_snoozed_until, review_prompt_count) on user_settings to authenticated;

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0064_app_reviews.sql')
on conflict do nothing;
