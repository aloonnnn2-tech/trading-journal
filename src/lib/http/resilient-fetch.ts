// One way to call an outside service: a timeout on every attempt, retries
// only where a retry is safe, and a circuit breaker so a service that is down
// is left alone for a while instead of being hammered by every request.
//
// Used for Yahoo market data. AI providers keep providerFetch
// (src/lib/ai-keys/providers/types.ts), which has its own timeouts and,
// deliberately, no retries: a retried generation is billed again to the
// user's own key.

/** The upstream is down, slow or refusing us -- not "no such thing". */
export class UpstreamUnavailableError extends Error {
  constructor(
    readonly upstream: string,
    readonly reason: string,
  ) {
    super(`${upstream} unavailable: ${reason}`);
    this.name = "UpstreamUnavailableError";
  }
}

/** Worth trying again: rate-limited, or a server-side failure. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Exponential backoff with full jitter: a random wait up to base * 2^attempt, capped. */
export function backoffDelay(attempt: number, baseMs: number, maxMs: number, random: () => number = Math.random): number {
  return Math.floor(random() * Math.min(maxMs, baseMs * 2 ** attempt));
}

/** Retry-After as milliseconds (seconds, or an HTTP date), or null when absent or unreadable. */
export function retryAfterMs(header: string | null, now: number = Date.now()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/**
 * Stops calling an upstream after `threshold` failures in a row, for
 * `cooldownMs`; then lets one request through to test it again.
 *
 * **Per serverless instance.** Each warm instance keeps its own count, so a
 * dead upstream is still tried once per instance per cooldown. That is the
 * point -- fewer calls to a service that is down, a clear answer sooner --
 * and needs no shared store.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly threshold = 5,
    private readonly cooldownMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  get state(): "closed" | "open" | "half-open" {
    if (this.openedAt === null) return "closed";
    return this.now() - this.openedAt >= this.cooldownMs ? "half-open" : "open";
  }

  canRequest(): boolean {
    return this.state !== "open";
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
  }

  recordFailure(): void {
    this.failures += 1;
    // A failed test request while half-open re-opens for a full cooldown.
    if (this.failures >= this.threshold || this.openedAt !== null) this.openedAt = this.now();
  }
}

export interface ResilientOptions {
  /** A name for errors and logs, e.g. "Yahoo". */
  upstream: string;
  /** Per attempt. */
  timeoutMs: number;
  /** Only idempotent calls are ever retried. */
  idempotent: boolean;
  /** Total attempts, first included. Default 3. */
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  breaker?: CircuitBreaker;
  /** For tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * fetch(), with a timeout per attempt, retries for idempotent calls on a
 * network error / 429 / 5xx (exponential backoff with jitter, honouring
 * Retry-After within maxDelayMs), and a circuit breaker.
 *
 * Returns the Response for anything the upstream actually answered --
 * including a 404, which means "no such thing", not "down". Throws
 * UpstreamUnavailableError when it is down, slow, rate-limiting us past
 * the retries, or its breaker is open.
 */
export async function resilientFetch(
  url: string,
  init: RequestInit & { next?: { revalidate?: number } },
  options: ResilientOptions,
): Promise<Response> {
  const {
    upstream,
    timeoutMs,
    idempotent,
    attempts = 3,
    baseDelayMs = 300,
    maxDelayMs = 2_000,
    breaker,
    fetchImpl = fetch,
    sleep = defaultSleep,
    random = Math.random,
  } = options;

  if (breaker && !breaker.canRequest()) {
    throw new UpstreamUnavailableError(upstream, "temporarily paused after repeated failures");
  }

  const maxAttempts = idempotent ? Math.max(1, attempts) : 1;
  let lastReason = "unknown";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const last = attempt === maxAttempts - 1;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    let wait = backoffDelay(attempt, baseDelayMs, maxDelayMs, random);

    try {
      const res = await fetchImpl(url, { ...init, signal });
      if (!isRetryableStatus(res.status)) {
        breaker?.recordSuccess();
        return res;
      }
      lastReason = `HTTP ${res.status}`;
      const asked = retryAfterMs(res.headers.get("retry-after"));
      // Asked to wait longer than we're willing to: give up now rather
      // than hold the request open.
      if (asked !== null && asked > maxDelayMs) break;
      if (asked !== null) wait = Math.max(wait, asked);
    } catch (err) {
      // The caller's own abort (a closed tab) is not the upstream's fault.
      if (init.signal?.aborted) throw err;
      lastReason = timeout.aborted ? `no answer within ${timeoutMs}ms` : "network error";
    }

    if (!last) await sleep(wait);
  }

  breaker?.recordFailure();
  throw new UpstreamUnavailableError(upstream, lastReason);
}
