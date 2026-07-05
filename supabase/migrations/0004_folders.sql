-- Custom folders (Swing Trades, Day Trades, Crypto, etc.). A trade can
-- belong to multiple folders, hence the join table rather than a single
-- folder_id column on trades.

create table folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table trade_folders (
  trade_id uuid not null references trades(id) on delete cascade,
  folder_id uuid not null references folders(id) on delete cascade,
  primary key (trade_id, folder_id)
);

create index trade_folders_folder_idx on trade_folders (folder_id);

alter table folders enable row level security;
alter table trade_folders enable row level security;

create policy "folders owner access"
  on folders for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "trade_folders owner access"
  on trade_folders for all
  using (exists (select 1 from folders f where f.id = folder_id and f.user_id = auth.uid()))
  with check (exists (select 1 from folders f where f.id = folder_id and f.user_id = auth.uid()));
