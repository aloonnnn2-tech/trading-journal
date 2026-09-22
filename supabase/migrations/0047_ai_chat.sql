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
