-- Per-user IANA timezone, auto-detected client-side on first load and
-- used to bucket day-of-week insights (Ask Your Journal, Insights) in the
-- trader's local time instead of UTC. Null until the client sets it once;
-- callers should fall back to "UTC" when reading a null value.

alter table user_settings add column timezone text;
