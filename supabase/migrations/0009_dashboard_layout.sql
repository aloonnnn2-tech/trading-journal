-- Custom Layout: per-user dashboard widget order + size, persisted next
-- to the other per-user UI prefs (hidden_core_fields) rather than a new
-- table, since it's the same "one settings row per user" shape.
alter table user_settings
  add column dashboard_layout jsonb not null default '{}'::jsonb;
