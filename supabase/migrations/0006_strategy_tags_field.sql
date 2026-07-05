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
