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

/**
 * The 429 half of the pattern, which was copy-pasted identically into eight
 * routes before this existed and would have been copy-pasted into a dozen
 * more by the end of this pass.
 *
 * Returns a ready-to-send response when the caller is over the limit, or
 * `null` when they are not -- so a route reads:
 *
 *     const limited = enforceRateLimit(`trades:${userId}`, 60, 60_000);
 *     if (limited) return limited;
 *
 * The message is deliberately written for a person rather than a log: a 429
 * with `{"error":"Too Many Requests"}` tells someone who just lost an import
 * nothing about whether to wait, retry, or give up. `Retry-After` is set on
 * every one of these because it is the header a browser, a proxy and a
 * well-behaved script all already know how to honour.
 */
export function enforceRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  message = "You're doing that a bit too quickly. Wait a moment and try again.",
): Response | null {
  const result = rateLimit(key, limit, windowMs);
  if (result.ok) return null;

  return Response.json(
    { error: message, retryAfterSeconds: result.retryAfterSeconds },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}

/**
 * Best-effort client address, for limiting traffic that has no user id yet.
 *
 * Every header here is client-settable in principle, so this is not an
 * identity and must never gate authorization -- it exists so that
 * unauthenticated request floods are bounded by *something* rather than
 * nothing. `x-nf-client-connection-ip` is set by Netlify's edge from the real
 * TCP peer and cannot be forged by the client; the others are fallbacks for
 * local dev and any other host. Falling back to a single shared bucket is
 * deliberate: a limit that everyone shares is still a limit, whereas keying
 * on a spoofable header per-request is the same as having none.
 */
export function clientIpKey(headers: Headers): string {
  const netlify = headers.get("x-nf-client-connection-ip");
  if (netlify) return netlify;

  const forwarded = headers.get("x-forwarded-for");
  // May be a comma-separated chain; the left-most entry is the original client.
  if (forwarded) return forwarded.split(",")[0]!.trim();

  return headers.get("x-real-ip") ?? "unknown";
}
