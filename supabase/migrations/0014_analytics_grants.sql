-- Postgres grants EXECUTE on new functions to PUBLIC by default, but some
-- Supabase projects revoke that default as a hardening measure. If this
-- project does, the admin_* functions added in 0013_analytics.sql would
-- silently fail with a permission error the moment PostgREST calls them as
-- the `authenticated` role, even though everything else in that migration
-- (table inserts, which use a separate privilege system already open on
-- this project) works fine. Grant explicitly so it works regardless.

grant execute on function admin_overview_stats() to authenticated;
grant execute on function admin_usage_series(int) to authenticated;
grant execute on function admin_feature_usage(int) to authenticated;
grant execute on function admin_retention_cohorts(int) to authenticated;
