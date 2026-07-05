-- Autosave version history: every time a trade row changes, the
-- pre-change row is snapshotted as jsonb. Implemented as an AFTER UPDATE
-- trigger rather than application-level snapshotting so every update
-- path (autosave debounce, duplicate, future bulk-edit features) is
-- covered automatically without each call site remembering to snapshot.
create table trade_history (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references trades(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create index trade_history_trade_idx on trade_history (trade_id, created_at desc);

alter table trade_history enable row level security;

create policy "trade_history owner access"
  on trade_history for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function snapshot_trade_history()
returns trigger as $$
begin
  insert into trade_history (trade_id, user_id, snapshot)
  values (old.id, old.user_id, to_jsonb(old));
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trades_snapshot_history
  before update on trades
  for each row
  execute function snapshot_trade_history();
