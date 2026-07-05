-- Run this FIRST if you hit "already exists" errors from a partial
-- previous run of 0001/0002. Safe only because this project has no real
-- data yet -- it drops and recreates the trading-journal schema objects.

drop trigger if exists on_auth_user_created_seed_fields on auth.users;
drop function if exists seed_default_field_definitions();

drop trigger if exists trades_set_updated_at on trades;
drop function if exists set_updated_at();

drop table if exists trades cascade;
drop table if exists field_definitions cascade;

drop type if exists trade_direction;
drop type if exists trade_result;
drop type if exists trade_status;
drop type if exists field_type;
drop type if exists entity_type;
