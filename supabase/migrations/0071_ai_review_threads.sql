-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it (live project, and the dev project for the tests). Until it is,
-- the "Explain or push back" thread under a trade review stays hidden.
--
-- 0071: debating a trade review (Alon, 2026-10-17). The trader explains why
-- they did something or pushes back; the AI says whether the reasoning holds
-- up, and when it changes its mind the review is revised. Every version is
-- kept, so the card can show what changed and why.
--
-- ai_reviews keeps holding the CURRENT review (one per trade, as 0032 made
-- it), so everything that reads reviews today is unchanged. The two tables
-- here hang off it and go when it goes.

create table if not exists ai_review_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  review_id uuid not null references ai_reviews (id) on delete cascade,
  version integer not null check (version >= 1),
  content jsonb not null check (pg_column_size(content) <= 1048576),
  provider text not null check (char_length(provider) <= 40),
  model text not null check (char_length(model) <= 200),
  -- What the thread changed, in a sentence. Null for version 1.
  changed_because text check (changed_because is null or char_length(changed_because) <= 1000),
  created_at timestamptz not null default now(),
  unique (review_id, version)
);

create table if not exists ai_review_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  review_id uuid not null references ai_reviews (id) on delete cascade,
  seq integer not null check (seq >= 0),
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 4000),
  -- The AI's reply only: did the trader's reasoning change its view?
  verdict text check (verdict is null or verdict in ('convinced', 'partly', 'not_convinced')),
  -- The review version this reply produced, when it revised the review.
  version_after integer,
  created_at timestamptz not null default now(),
  unique (review_id, seq)
);

create index if not exists ai_review_versions_user_idx on ai_review_versions (user_id, review_id);
create index if not exists ai_review_messages_user_idx on ai_review_messages (user_id, review_id, seq);

alter table ai_review_versions enable row level security;
alter table ai_review_messages enable row level security;

-- Owner access, and the review must be the owner's too: a foreign key alone
-- would let a row point at someone else's review (the lesson of 0048).
create policy "ai_review_versions owner access"
  on ai_review_versions for all
  using (
    auth.uid() = user_id
    and exists (select 1 from ai_reviews r where r.id = ai_review_versions.review_id and r.user_id = auth.uid())
  )
  with check (
    auth.uid() = user_id
    and exists (select 1 from ai_reviews r where r.id = ai_review_versions.review_id and r.user_id = auth.uid())
  );

create policy "ai_review_messages owner access"
  on ai_review_messages for all
  using (
    auth.uid() = user_id
    and exists (select 1 from ai_reviews r where r.id = ai_review_messages.review_id and r.user_id = auth.uid())
  )
  with check (
    auth.uid() = user_id
    and exists (select 1 from ai_reviews r where r.id = ai_review_messages.review_id and r.user_id = auth.uid())
  );

-- 0032 limited ai_reviews.provider to the first six providers; 0041 added
-- three more to keys and consents but not here, so a review through Mistral
-- or SambaNova failed when it was saved -- after the user's quota was spent.
-- The app validates the provider; the column doesn't need to.
alter table ai_reviews drop constraint if exists ai_reviews_provider_check;

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0071_ai_review_threads.sql')
on conflict do nothing;
