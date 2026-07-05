create table trade_images (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references trades(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  created_at timestamptz default now()
);

alter table trade_images enable row level security;

create policy "trade_images owner access"
  on trade_images for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index trade_images_trade_id_idx on trade_images(trade_id);
