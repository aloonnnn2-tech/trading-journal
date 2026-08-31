import type { AIProviderName } from "../types";

/**
 * What went wrong when talking to a provider.
 *
 * The ask route turns these into three distinct user-facing messages, because
 * they need three different actions from the user: fix your key, wait and
 * retry, or report a bug. Collapsing them into one "something went wrong"
 * leaves a user with a revoked key retrying forever.
 */
export type ProviderFailure =
  /** The provider rejected the credentials -- revoked, mistyped, or wrong provider. */
  | "invalid_key"
  /** Reachable but unable to answer right now: rate limit, quota, outage, timeout. */
  | "unavailable"
  /** The configured model id no longer exists, or this key can't reach it. */
  | "model_missing"
  /** The reply hit the token ceiling before producing any visible text. */
  | "truncated"
  /** Anything else, including responses we couldn't parse. */
  | "failed";

export class ProviderError extends Error {
  readonly failure: ProviderFailure;
  /** Provider-side detail for server logs. Never sent to the client. */
  readonly detail: string;

  constructor(failure: ProviderFailure, detail: string) {
    // The message is deliberately generic; `detail` carries anything
    // provider-specific so a caller can't accidentally serialize a raw
    // provider error body (which can echo back parts of the request) into an
    // HTTP response.
    super(`Provider request failed: ${failure}`);
    this.name = "ProviderError";
    this.failure = failure;
    this.detail = detail;
  }
}

export interface AIProvider {
  name: AIProviderName;

  /** The model this provider asks by default, surfaced in the UI. */
  readonly model: string;

  /**
   * Cheap liveness check used to test a key before it is ever stored.
   * Returns false for "the provider says these credentials are bad" and
   * throws ProviderError("unavailable") when we couldn't get an answer at
   * all -- the difference matters, because refusing to save a good key
   * because the provider was briefly down would be its own bad experience.
   */
  validateKey(apiKey: string): Promise<boolean>;

  /** Single-turn question. Throws ProviderError on any failure. */
  askQuestion(apiKey: string, systemPrompt: string, question: string): Promise<string>;
}

// A provider that hangs would hold a serverless function open until the
// platform kills it, burning the full timeout on every stuck request. These
// bound that: validation is a metadata call and should be near-instant, while
// a real answer may legitimately take a while.
export const VALIDATE_TIMEOUT_MS = 10_000;
// Must stay below the ask route's `maxDuration`, which in turn stays below
// the hosting platform's request ceiling. At 45s this could never actually
// fire: the platform would kill the request first and replace our specific
// error with its own generic one. Lower is genuinely better here -- an
// explained timeout beats an unexplained one.
export const ASK_TIMEOUT_MS = 22_000;

/**
 * Caps the answer length. This is the user's own quota being spent.
 *
 * Sized with headroom because several current models are *reasoning* models:
 * they spend tokens thinking before writing, and that spend comes out of this
 * same budget. Too tight and the thinking consumes it all, leaving an empty
 * `content` and `finish_reason: "length"` -- an answer that never starts.
 */
export const MAX_ANSWER_TOKENS = 2500;

/**
 * Maps an HTTP status onto a failure kind. Shared so all three providers
 * classify identically -- otherwise "bad key" on one provider and "unavailable"
 * on another for the same 401 would produce inconsistent advice.
 */
export function failureFromStatus(status: number): ProviderFailure {
  // 401/403: rejected credentials. 400 is deliberately NOT treated as a key
  // problem in general -- it usually means a malformed request, which is our
  // bug, not the user's -- except where a provider signals a bad key that way
  // (Google), which that provider handles itself.
  if (status === 401 || status === 403) return "invalid_key";
  // 429 is a rate limit or an exhausted quota on the user's own account, and
  // 5xx is the provider having a bad day. Both are "try again later".
  if (status === 429 || status >= 500) return "unavailable";
  return "failed";
}

/**
 * fetch() with a hard timeout, returning a ProviderError rather than the
 * assorted DOMException/TypeError shapes the platform throws, so callers have
 * exactly one error type to handle.
 */
export async function providerFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    // A timeout and a DNS/TLS failure are both "couldn't reach them", which is
    // the same advice to the user either way.
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    throw new ProviderError("unavailable", `network: ${reason}`);
  }
}

/** Reads an error body for logging, bounded so a huge HTML error page can't
 *  flood the logs. Never returned to the client. */
export async function errorDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return `HTTP ${res.status}: ${text.slice(0, 500)}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}
