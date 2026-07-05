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
