-- Fast partial-text search on ticker/company for the Milestone 4
-- search bar, plus the trgm extension it depends on. The existing
-- (user_id, status) and (user_id, entry_date) btree indexes from 0001
-- already cover status-tab filtering and date sorting.

create extension if not exists pg_trgm;

create index trades_ticker_trgm_idx on trades using gin (ticker gin_trgm_ops);
create index trades_company_name_trgm_idx on trades using gin (company_name gin_trgm_ops);
