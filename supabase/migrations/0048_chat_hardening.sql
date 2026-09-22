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
