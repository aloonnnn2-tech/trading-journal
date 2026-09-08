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
