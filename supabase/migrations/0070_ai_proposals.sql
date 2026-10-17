-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it (live project, and the dev project for the tests). Until it is,
-- Ask simply doesn't offer to change anything.
--
-- 0070: changes Ask suggests, that happen only when the user presses Apply
-- (Alon, 2026-10-17: fill an empty trade field, tag a strategy, add a note,
-- tag a mistake, create a goal).
--
-- Why a table of its own rather than ai_messages.parts: a user can write
-- rows in their own conversation through PostgREST (SECURITY.md, "Known and
-- accepted"), so the transcript must never be what Apply trusts. A proposal
-- here is written by the server when the model calls a propose_ tool, shown
-- to the user exactly as stored (`display`), and on Apply its `payload` is
-- validated again by the same schemas as the normal edit routes and checked
-- against the trade as it is THEN (`before`). The model can only ever cause
-- a card to appear; a person's click is what changes the journal.

create table if not exists ai_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid not null references ai_conversations (id) on delete cascade,
  -- The tool call that made it. Unique per conversation, so a round that is
  -- re-run after an interruption finds its proposal instead of a second one.
  tool_call_id text not null check (char_length(tool_call_id) <= 200),
  kind text not null check (kind in ('fill_field', 'tag_strategy', 'add_note', 'tag_mistake', 'create_goal')),
  -- The trade it changes; null for a goal. Deleting the trade deletes the card.
  trade_id uuid references trades (id) on delete cascade,
  -- What Apply writes, already validated once.
  payload jsonb not null check (pg_column_size(payload) <= 16384),
  -- The values the user saw as "before", for the changed-since check.
  before jsonb check (before is null or pg_column_size(before) <= 16384),
  -- What the card shows, built by the server from the validated payload.
  display jsonb not null check (pg_column_size(display) <= 16384),
  status text not null default 'pending'
    check (status in ('pending', 'applying', 'applied', 'dismissed', 'stale', 'failed')),
  -- Why it ended stale/failed, in words for the card.
  outcome text check (outcome is null or char_length(outcome) <= 500),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (conversation_id, tool_call_id)
);

create index if not exists ai_proposals_user_conversation_idx
  on ai_proposals (user_id, conversation_id, created_at);

alter table ai_proposals enable row level security;

-- Owner access, and the conversation must be the owner's too -- the lesson
-- of 0048: a foreign key alone let a row point into someone else's chat.
create policy "ai_proposals owner access"
  on ai_proposals for all
  using (
    auth.uid() = user_id
    and exists (
      select 1 from ai_conversations c
      where c.id = ai_proposals.conversation_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from ai_conversations c
      where c.id = ai_proposals.conversation_id
        and c.user_id = auth.uid()
    )
  );

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0070_ai_proposals.sql')
on conflict do nothing;
