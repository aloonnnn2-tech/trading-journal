// Per-user volume limits, in one place (security gaps pass, item 5.1).
//
// Sized from real usage, measured read-only on the live database on
// 2026-10-18, with wide headroom so no honest trader ever meets them:
//   - trades: largest account 334; at most 5 created in one day, 4 in an hour
//   - screenshots: 15 files, 0.4 MB in total; at most 10 per account, 2 a day;
//     average 29 KB after re-encoding (the per-file cap is 4 MB)
//   - custom fields: at most 20 per account; folders: at most 4
// The real ceiling they protect is Supabase's free plan: 1 GB of file storage
// for EVERY user together, and a 500 MB database.
//
// Limits that live elsewhere, by design:
//   - per-request size: src/lib/http/upload-limits.ts (4 MB file) and
//     src/lib/http/body-limits.ts (request bodies)
//   - per-minute bursts: each route's enforceRateLimit, and the proxy's 300/min
//   - per-day feature caps (AI, OCR, imports, exports, market data):
//     src/lib/rate-limits/daily.ts
//   - rows per account: the database itself (0067, plus 0074 for the newest
//     tables), so they hold even for a direct API write; isRowLimitError()
//     below turns one into a clear answer.

/** Screenshots one account may keep, across all its trades. */
export const MAX_IMAGES_PER_USER = 2_000;

/** Screenshot storage one account may use. 200 MB is ~7,000 typical screenshots. */
export const MAX_IMAGE_BYTES_PER_USER = 200 * 1024 * 1024;

/** Screenshots one account may upload per day. */
export const MAX_IMAGE_UPLOADS_PER_DAY = 100;

/** Trades created one at a time (new trade, duplicate) per hour. Imports have their own daily cap. */
export const MAX_TRADES_CREATED_PER_HOUR = 300;

/** Postgres raises 54000 when a 0067/0074 row cap is reached. */
export function isRowLimitError(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "54000";
}

export const ROW_LIMIT_MESSAGE =
  "This account has reached its limit for that. Delete some you no longer need, or contact support if you need more.";

export const ROW_LIMIT_IMPORT_MESSAGE =
  "Stopped: this account has reached its limit of trades. The rows before this point were imported; delete trades you no longer need to import the rest.";

/** A clear 429 for a row-cap error, or null for any other error (rethrow it). */
export function rowLimitResponse(err: unknown): Response | null {
  return isRowLimitError(err) ? Response.json({ error: ROW_LIMIT_MESSAGE }, { status: 429 }) : null;
}
