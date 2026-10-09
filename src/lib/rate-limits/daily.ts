import { rateLimit } from "@/lib/rate-limit";

/**
 * Per-user DAILY caps on the routes that cost real money or real CPU
 * (security hardening, Phase 2). The per-minute limits in each route stop a
 * burst; these stop a slow, steady drain -- a script running one call every
 * few seconds all day stays under every per-minute limit and still runs up
 * the bill.
 *
 * One table so every cap is visible and comparable in one place. Each number
 * sits far above what a person using the app does in a day, so only
 * automation ever meets it:
 *
 *   ocr          screenshot reads -- PaddleOCR in a child process, the
 *                heaviest CPU path in the app
 *   ai-review    AI trade + period reviews (shared)
 *   chat-turn    Ask turns; each one is a provider call on the user's key
 *                and up to a minute of function time on ours
 *   import       CSV/XLSX/JSON imports and XLSX parsing (shared)
 *   export       journal exports
 *   excursions   MAE/MFE recompute -- one Yahoo call per trade
 *   market-data  candle/bar/fx lookups (shared); protects the unofficial
 *                Yahoo endpoint from being hammered through us
 */
export const DAILY_CAPS = {
  ocr: { limit: 200, what: "screenshot reads" },
  "ai-review": { limit: 100, what: "AI reviews" },
  "chat-turn": { limit: 500, what: "Ask messages" },
  import: { limit: 100, what: "imports" },
  export: { limit: 200, what: "exports" },
  excursions: { limit: 50, what: "excursion recalculations" },
  "market-data": { limit: 3000, what: "price lookups" },
} as const;

export type DailyCapFeature = keyof typeof DAILY_CAPS;

const DAY_MS = 24 * 60 * 60 * 1000;

function hoursText(seconds: number): string {
  const hours = Math.ceil(seconds / 3600);
  return hours <= 1 ? "within the hour" : `in about ${hours} hours`;
}

/**
 * Counts one use of `feature` for `userId` and returns a ready 429 when the
 * day's cap is used up, or null. Fails open like every other limit here: a
 * broken counter must not take a feature away from everyone.
 */
export async function enforceDailyCap(feature: DailyCapFeature, userId: string): Promise<Response | null> {
  const cap = DAILY_CAPS[feature];
  const result = await rateLimit(`daily:${feature}:${userId}`, cap.limit, DAY_MS);
  if (result.ok) return null;
  return Response.json(
    {
      error: `You've reached today's limit of ${cap.limit} ${cap.what}. It resets ${hoursText(result.retryAfterSeconds)}.`,
      retryAfterSeconds: result.retryAfterSeconds,
    },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}

/**
 * Upstream ceiling for the unofficial Yahoo endpoint, across ALL users
 * together. The per-user caps bound one account; this bounds the app, so a
 * crowd of accounts (or one person with many) cannot turn this server into a
 * Yahoo scraper and get its IP blocked for everyone. Cached responses are
 * served by Next's fetch cache before the upstream is touched, so this mostly
 * counts route calls, which is the conservative side.
 */
export const YAHOO_GLOBAL_PER_MINUTE = 600;

export async function enforceYahooCeiling(): Promise<Response | null> {
  const result = await rateLimit("upstream:yahoo", YAHOO_GLOBAL_PER_MINUTE, 60_000);
  if (result.ok) return null;
  return Response.json(
    {
      error: "Price data is busy right now. Try again in a minute.",
      retryAfterSeconds: result.retryAfterSeconds,
    },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}
