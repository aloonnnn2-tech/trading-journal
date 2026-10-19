import { enforceRateLimit } from "@/lib/rate-limit";
import { MAX_TRADES_CREATED_PER_HOUR } from "@/lib/limits";

/**
 * The limits on creating trades one at a time (new trade, duplicate -- a
 * duplicate is a new trade). Creating one is a button press, so 60 a minute
 * is far above real use while stopping a loop from filling an account with
 * blank rows; the hourly cap stops a slow loop that stays under it. Bulk
 * entry has its own path and daily cap (Import).
 */
export async function enforceTradeCreateLimits(userId: string): Promise<Response | null> {
  const burst = await enforceRateLimit(
    `trades-create:${userId}`,
    60,
    60_000,
    "You're creating trades faster than we can keep up. Wait a moment and try again.",
  );
  if (burst) return burst;
  return enforceRateLimit(
    `trades-create-hour:${userId}`,
    MAX_TRADES_CREATED_PER_HOUR,
    60 * 60_000,
    `You've created ${MAX_TRADES_CREATED_PER_HOUR} trades in the last hour, the most one account can add one at a time. To add many at once, use Import.`,
  );
}
