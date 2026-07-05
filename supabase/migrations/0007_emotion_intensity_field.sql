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
