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
 * quietly held less than they claimed. It happened again with 0047's
 * ai_conversations and ai_messages, caught in review two days later.
 *
 * And a third time: 0070's ai_proposals, 0071's ai_review_versions and
 * ai_review_messages and 0072's admin_audit_log were missing until the
 * security gaps pass (G-7, 2026-10-18).
 *
 * So: **any migration that creates a table must add it here, or to
 * BACKUP_EXCLUDED below with the reason.** That is now checked:
 * src/lib/backup/db-tables.drift.test.ts reads every `create table` in
 * supabase/migrations and fails on a table that is in neither list, and on a
 * child table listed before the parent its foreign key needs.
 *
 * ORDER MATTERS for restore, not for backup. Every table below references
 * auth.users; several also reference each other:
 *   field_definitions.strategy_id -> strategies (0017)
 *   ai_proposals        -> ai_conversations, trades (0070)
 *   ai_review_versions, ai_review_messages -> ai_reviews (0071)
 *   trade_folders       -> trades, folders
 *   trade_strategies    -> trades, strategies
 *   trade_history       -> trades
 *   trade_images        -> trades
 *   trade_excursions    -> trades
 *   ai_reviews          -> trades
 *   strategy_rules      -> strategies
 *   analytics_events    -> analytics_sessions
 *   ai_conversations    -> user_api_keys  (key_id, on delete set null)
 *   ai_messages         -> ai_conversations
 *   trades.commission_rule_id -> commission_rules (0056, on delete set null)
 *   monthly_cost_postings -> monthly_costs, account_transactions (0057)
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
  "folders",
  "strategies",
  "commission_rules",
  "monthly_costs",
  "ai_provider_consents",
  // Encrypted with AI_KEY_ENCRYPTION_SECRET (see src/lib/ai-keys/crypto.ts),
  // so a dump alone yields no usable provider key -- but it is still the most
  // sensitive table here, and the reason backups must never be stored
  // anywhere readable. See .github/workflows/backup.yml, which encrypts.
  "user_api_keys",
  "goals",
  // Your review of Trading Lens (0064). Depends only on auth.users.
  "app_reviews",
  "analytics_sessions",
  // The operator's security record (0072): admin actions, exports, account
  // deletions -- ids only. After a restore it is also the list of accounts
  // deleted since the backup was taken, which must be deleted again
  // (docs/security/restore-test.md).
  "admin_audit_log",
  // Paid-plan sign-ups (0050): email addresses with no account behind them.
  // Backed up since 2026-10-19 (Alon's decision, gaps report Q13); losing it
  // lost the list for good. No foreign keys.
  "waitlist",
  // The Get help form (0075). user_id is null for requests sent signed out.
  "help_requests",

  // --- Depends on user_api_keys (0047) ----------------------------------
  // Chat transcripts: the model's tool results here are the user's own
  // journal data re-serialised, so this is as sensitive as `trades`.
  "ai_conversations",
  "ai_messages",

  // --- Depends on strategies -------------------------------------------
  // field_definitions.strategy_id (0017): it sat in the first group until the
  // drift test caught it (2026-10-18), so a restore into a fresh project
  // failed on the first strategy-specific field.
  "field_definitions",
  "strategy_rules",
  "trades",

  // --- Depends on trades -----------------------------------------------
  "trade_history",
  "trade_images",
  "trade_folders",
  "trade_strategies",
  "trade_excursions",
  "ai_reviews",
  // Ask's suggested changes (0070): reference ai_conversations and trades.
  "ai_proposals",

  // --- Depends on ai_reviews (0071) -------------------------------------
  "ai_review_versions",
  "ai_review_messages",

  // --- Depends on auth.users / analytics_sessions ----------------------
  "account_transactions",
  "analytics_events",

  // --- Depends on monthly_costs and account_transactions (0057) --------
  // Which months each cost has been taken for: without it a restore would
  // take every cost again for the last twelve months.
  "monthly_cost_postings",
] as const;

export type BackupTable = (typeof TABLES)[number];

/**
 * Tables deliberately NOT backed up, with the reason. The drift test makes
 * every table be in TABLES or here.
 */
export const BACKUP_EXCLUDED: Record<string, string> = {
  schema_migrations: "Describes the schema, not data; restoring it would claim migrations ran that didn't.",
  rate_limit_counters: "Abuse counters that expire within a day.",
  idempotency_keys: "Request replay copies kept a day.",
  public_page_views: "Anonymous daily totals; cheap to lose.",
  account_deletion_requests: "A pending 'delete my account' link, valid for an hour (0076).",
};
