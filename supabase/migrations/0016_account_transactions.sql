-- Account cash ledger: each row is a manual deposit (positive amount) or
-- withdrawal (negative amount). Current cash is never stored -- it's always
-- derived as sum(account_transactions.amount) + sum(trades.dollar_pl), so
-- editing or deleting a trade can never leave a stale balance behind.

create table account_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric not null,
  note text,
  created_at timestamptz not null default now()
);

create index account_transactions_user_created_idx
  on account_transactions (user_id, created_at desc);

alter table account_transactions enable row level security;

create policy "account_transactions owner access"
  on account_transactions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
