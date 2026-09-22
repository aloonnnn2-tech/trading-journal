// Budgets shared by the two routes that check a key against its provider:
// saving one (POST /api/ai-keys) and testing a stored one
// (POST /api/ai-keys/[id]/test).
//
// Each check is an outbound request to a third party from this app's IP,
// which makes the pair an oracle for validating a list of stolen keys at
// someone else's expense. The per-minute limits on each route bound the
// burst; this shared daily bucket bounds the total. Fifty a day is far above
// what one person juggling a handful of keys ever does.

export const KEY_CHECKS_PER_DAY = 50;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** One bucket for both routes, per user. */
export function keyCheckDailyBucket(userId: string): string {
  return `ai-key-checks-day:${userId}`;
}
