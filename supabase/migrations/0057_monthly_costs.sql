-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
--
-- Monthly costs (Alon, 2026-09-29): platform, data or account fees charged
-- per month rather than per trade. Each month one is due, it is taken from
-- the user's cash as a withdrawal in account_transactions (0016) -- the same
-- ledger deposits and withdrawals live in, so the balance, available cash
-- and position-size prefill all see it with no other change.

create table if not exists monthly_costs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  -- In `currency` (null = the account's own), converted at `fx_rate`.
  amount numeric not null check (amount > 0 and amount < 10000000),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  fx_rate numeric check (fx_rate is null or (fx_rate > 0 and fx_rate < 100000)),
  -- 1-28, so every month has the day.
  day_of_month int not null default 1 check (day_of_month between 1 and 28),
  starts_on date not null default current_date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (currency is null or fx_rate is not null)
);

create index if not exists monthly_costs_user_idx on monthly_costs (user_id);

create trigger monthly_costs_set_updated_at
  before update on monthly_costs
  for each row execute function set_updated_at();

alter table monthly_costs enable row level security;

create policy "monthly_costs owner access"
  on monthly_costs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- One row per cost per month taken. The primary key is what makes taking a
-- month idempotent: two page loads racing to take September both try to
-- insert (cost, 2026-09-01); one wins, the other skips. Deleting a cost
-- removes these rows but not the withdrawals -- money already taken stays
-- in the ledger, where the user can delete it like any other entry.
create table if not exists monthly_cost_postings (
  cost_id uuid not null references monthly_costs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  transaction_id uuid references account_transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (cost_id, month)
);

alter table monthly_cost_postings enable row level security;

create policy "monthly_cost_postings owner access"
  on monthly_cost_postings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0057_monthly_costs.sql')
on conflict do nothing;
