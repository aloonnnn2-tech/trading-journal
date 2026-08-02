// Minimal in-memory sliding-window rate limiter, keyed by user id.
//
// **Known limitation, deliberate:** serverless instances don't share memory,
// so this bounds abuse *per warm instance* rather than globally -- a client
// whose requests land on several cold instances gets a proportionally higher
// effective limit. That's an acceptable trade here: the goal is to stop one
// looping client from running up Netlify compute on the OCR route, which this
// does, without taking on Redis or a Postgres round-trip per request. If this
// ever needs to be a real global limit, that's the upgrade path.
//
// No dependency, no infrastructure, and it fails open on anything unexpected
// -- a rate limiter that breaks the app it protects is worse than none.

interface Window {
  hits: number[];
}

const windows = new Map<string, Window>();

// Bound the map itself: without this, a long-lived instance accumulates one
// entry per user id forever, which is its own slow leak.
const MAX_TRACKED_KEYS = 10_000;

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the oldest hit falls out of the window. */
  retryAfterSeconds: number;
}

/**
 * @param key      Caller-scoped identity, e.g. `ocr:<userId>`.
 * @param limit    Max requests allowed inside the window.
 * @param windowMs Window length in milliseconds.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const cutoff = now - windowMs;

  if (windows.size > MAX_TRACKED_KEYS) windows.clear();

  const existing = windows.get(key);
  // Drop hits that have aged out, so the window actually slides.
  const hits = (existing?.hits ?? []).filter((t) => t > cutoff);

  if (hits.length >= limit) {
    const oldest = hits[0];
    windows.set(key, { hits });
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }

  hits.push(now);
  windows.set(key, { hits });
  return { ok: true, retryAfterSeconds: 0 };
}
