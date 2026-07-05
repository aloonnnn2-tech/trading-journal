-- Per-user UI preferences, starting with which built-in (core column)
-- trade fields are hidden. Core columns can't be deleted like custom
-- fields (they're fixed columns used for fast filtering/analytics), but
-- users can still choose to hide ones they don't use, e.g. Stop Loss.

create table user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  hidden_core_fields text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger user_settings_set_updated_at
  before update on user_settings
  for each row
  execute function set_updated_at();

alter table user_settings enable row level security;

create policy "user_settings owner access"
  on user_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function seed_user_settings()
returns trigger as $$
begin
  insert into public.user_settings (user_id) values (new.id);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created_seed_settings
  after insert on auth.users
  for each row
  execute function seed_user_settings();
