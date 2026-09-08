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
