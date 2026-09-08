/**
 * "That table doesn't exist yet."
 *
 * 42P01 is Postgres' undefined_table; PGRST205 is PostgREST failing to find it
 * in its schema cache. This project applies migrations BY HAND (see the header
 * of every file in supabase/migrations), so there is always a window where the
 * code is deployed and the migration is not yet applied -- and the same window
 * reopens on any fresh environment. Detecting it is what lets a page say "a
 * migration is pending" instead of showing a bare 500.
 *
 * Lives here rather than in one feature's queries module because more than one
 * feature now needs it (AI reviews, plan rules) and a second copy would be a
 * second list of codes to keep in step. Same reasoning as the missing-COLUMN
 * handling in src/lib/trades/history.ts, which exists for the same window.
 */
export function isMissingTableError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || code === "PGRST205";
}

/**
 * "That column doesn't exist yet."
 *
 * The same hand-applied-migration window as above, one level down: 42703 is
 * Postgres' undefined_column, and PGRST204 is PostgREST rejecting a write to a
 * column missing from its schema cache. A feature that adds a column rather
 * than a table (0037's dismissed suggestions) needs this rather than the table
 * check, and gets to say "a migration is pending" for the same reason.
 */
export function isMissingColumnError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "42703" || code === "PGRST204";
}
