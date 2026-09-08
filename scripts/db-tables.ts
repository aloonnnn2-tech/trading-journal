/**
 * The user-data tables, in an order safe to restore in (parents first).
 *
 * Shared by scripts/backup-db.ts and scripts/restore-db.ts so the two can
 * never disagree about what "the data" is. It lives in its own module rather
 * than being exported from backup-db.ts because that file runs its main() on
 * import -- importing it from the restore script would take a backup as a
 * side effect of trying to restore one.
 *
 * **THIS LIST GOES STALE SILENTLY, AND HAS.** It was written when the schema
 * had 13 tables and was never updated as migrations added more, so
 * ai_provider_consents (0031), ai_reviews (0032), strategy_rules (0033),
 * trade_excursions (0035), goals (0036) and user_api_keys (0029) were all
 * missing from it -- six tables of real user data that every backup taken
 * before 2026-09-08 silently does not contain. Nothing failed; the dumps just
 * quietly held less than they claimed.
 *
 * So: **any migration that creates a table must add it here.** There is no
 * automatic check, because the obvious one (read information_schema) is not
 * reachable -- this project has REST access only and PostgREST does not
 * expose that schema. `grep -h "create table" supabase/migrations/*.sql` is
 * the manual equivalent, and is worth running whenever this list is touched.
 *
 * ORDER MATTERS for restore, not for backup. Every table below references
 * auth.users; several also reference each other:
 *   trades.strategy_id  -> strategies    (0018)
 *   trade_folders       -> trades, folders
 *   trade_strategies    -> trades, strategies
 *   trade_history       -> trades
 *   trade_images        -> trades
 *   trade_excursions    -> trades
 *   ai_reviews          -> trades
 *   strategy_rules      -> strategies
 *   analytics_events    -> analytics_sessions
 * Inserting a child before its parent fails the foreign key, so the parents
 * come first and `trades` sits after `strategies`.
 *
 * `schema_migrations` (0040) is deliberately absent: it describes the schema,
 * not the user's data, and restoring it into a fresh project would assert
 * that migrations had been applied there when they had not.
 */
export const TABLES = [
  // --- Independent of everything but auth.users ------------------------
  "user_settings",
  "field_definitions",
  "folders",
  "strategies",
  "commission_rules",
  "ai_provider_consents",
  // Encrypted with AI_KEY_ENCRYPTION_SECRET (see src/lib/ai-keys/crypto.ts),
  // so a dump alone yields no usable provider key -- but it is still the most
  // sensitive table here, and the reason backups must never be stored
  // anywhere readable. See .github/workflows/backup.yml, which encrypts.
  "user_api_keys",
  "goals",
  "analytics_sessions",

  // --- Depends on strategies -------------------------------------------
  "strategy_rules",
  "trades",

  // --- Depends on trades -----------------------------------------------
  "trade_history",
  "trade_images",
  "trade_folders",
  "trade_strategies",
  "trade_excursions",
  "ai_reviews",

  // --- Depends on auth.users / analytics_sessions ----------------------
  "account_transactions",
  "analytics_events",
] as const;

export type BackupTable = (typeof TABLES)[number];
