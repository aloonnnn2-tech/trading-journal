import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Global rate limiter, backed by a shared Postgres counter (see
// supabase/migrations/0042_rate_limit_counters.sql). It replaced an in-memory
// map whose counters lived per serverless instance -- so a client spread across
// warm instances got a proportionally higher effective limit, and every cold
// start reset the window. One shared table makes the ceiling real across the
// whole deployment.
//
// **Fails open on anything unexpected.** Migration not yet applied, DB briefly
// unreachable, service-role env absent -- all of these allow the request rather
// than blocking it. A rate limiter that breaks the app it protects is worse
// than none, and this keeps a database blip from 429ing every user at once. It
// also means deploying this code before the migration is applied is harmless:
// the limiter simply allows until the function exists.

let cachedClient: SupabaseClient | null = null;

// Lazily built, memoized, service-role, no session.
//
// **Service-role, deliberately.** `rate_limit_hit` is granted to `service_role`
// only. The anon key ships in the browser bundle, so granting the function to
// anon would let anyone call it with `bucket = 'api:<victimUserId>'` and
// pre-exhaust another user's limit -- a free denial of service. The counter is
// therefore only ever touched by this server-side key. This module is imported
// only by server code (the proxy and API routes); `npm run check:bundle` is the
// standing guard that the service-role key can never reach a client bundle.
function rpcClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("rate-limit: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  }
  cachedClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedClient;
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the current window resets. */
  retryAfterSeconds: number;
}

/**
 * Records one hit against `key` and reports whether it is within `limit` per
 * `windowMs`. Always resolves -- never rejects -- so callers never need a
 * try/catch; an internal failure resolves to `{ ok: true }` (fail open).
 *
 * @param key      Caller-scoped identity/bucket, e.g. `ocr:<userId>`.
 * @param limit    Max requests allowed inside the window.
 * @param windowMs Window length in milliseconds.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  try {
    const { data, error } = await rpcClient().rpc("rate_limit_hit", {
      p_bucket: key,
      p_max: limit,
      p_window_seconds: Math.max(1, Math.ceil(windowMs / 1000)),
    });
    if (error || !data || typeof data !== "object") {
      return { ok: true, retryAfterSeconds: 0 };
    }
    const allowed = (data as { allowed?: unknown }).allowed;
    const retry = (data as { retry_after_seconds?: unknown }).retry_after_seconds;
    return {
      // Only an explicit `false` blocks; any unexpected shape fails open.
      ok: allowed !== false,
      retryAfterSeconds: typeof retry === "number" && retry > 0 ? retry : 0,
    };
  } catch {
    return { ok: true, retryAfterSeconds: 0 };
  }
}

/**
 * The 429 half of the pattern, which was copy-pasted identically into eight
 * routes before this existed and would have been copy-pasted into a dozen
 * more by the end of this pass.
 *
 * Returns a ready-to-send response when the caller is over the limit, or
 * `null` when they are not -- so a route reads:
 *
 *     const limited = await enforceRateLimit(`trades:${userId}`, 60, 60_000);
 *     if (limited) return limited;
 *
 * **Note the `await`.** This is async now (it does a database round-trip); a
 * caller that forgets the await gets a truthy Promise and 429s every request.
 *
 * The message is deliberately written for a person rather than a log: a 429
 * with `{"error":"Too Many Requests"}` tells someone who just lost an import
 * nothing about whether to wait, retry, or give up. `Retry-After` is set on
 * every one of these because it is the header a browser, a proxy and a
 * well-behaved script all already know how to honour.
 */
export async function enforceRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  message = "You're doing that a bit too quickly. Wait a moment and try again.",
): Promise<Response | null> {
  const result = await rateLimit(key, limit, windowMs);
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
