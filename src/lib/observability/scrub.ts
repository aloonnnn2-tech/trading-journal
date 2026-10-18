// Last line of defence against a provider API key reaching Sentry.
//
// **Nothing in this app deliberately logs a key.** The plaintext exists only
// inside `preflightProviderCall` -> the provider request, providers pass it in
// a header rather than a URL (see providers/google.ts for why that matters),
// and `ProviderError` carries a generic message with provider detail kept in a
// separate field that is never serialized into a response.
//
// This exists because "nothing deliberately logs it" is a property of today's
// code, not a guarantee about tomorrow's. An unhandled exception carries a
// stack, local scope in some runtimes, request headers, and whatever a future
// `console.error` decided to include. Sentry then ships all of that to a third
// party and keeps it. One accidental interpolation is the whole breach.
//
// So: everything leaving for Sentry is walked, and anything shaped like a
// credential is replaced before it goes. Redaction is deliberately aggressive.
// A redacted error is mildly harder to debug; a leaked key is a user's money.

/**
 * Patterns for the credentials this app handles.
 *
 * Ordered longest-prefix-first where prefixes overlap (`sk-or-` before `sk-`),
 * because an earlier match consumes the text an later one would have caught,
 * and a partially-redacted key is still a leaked key.
 */
const SECRET_PATTERNS: RegExp[] = [
  // OpenRouter, before the bare OpenAI `sk-` rule below can eat the prefix.
  /\bsk-or-[A-Za-z0-9_-]{16,}/g,
  // OpenAI and the many providers that copied its format, including `sk-proj-`.
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  // Anthropic.
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
  // Google AI Studio.
  /\bAIza[A-Za-z0-9_-]{20,}/g,
  // Groq.
  /\bgsk_[A-Za-z0-9_-]{16,}/g,
  // Cerebras.
  /\bcsk-[A-Za-z0-9_-]{16,}/g,
  // GitHub (the retired GitHub Models provider: stored keys still decrypt).
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  // Mistral and SambaNova issue unprefixed tokens (32 alphanumerics; a UUID),
  // which no prefix rule can catch. Anything sitting in a credential header
  // or after "Bearer" is redacted whatever it looks like.
  /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{16,}/g,
  /\b(x-api-key|x-goog-api-key|api[-_]?key|authorization|access[-_]?token|refresh[-_]?token|token|secret|password)(["']?\s*[:=]\s*["']?)[^\s"',;]{8,}/gi,
  // A bare Mistral-style key: 32+ letters and digits mixing upper case, lower
  // case and digits. Hex hashes, commit SHAs and ids are single-case, so they
  // stay readable in a report; a random mixed-case run of that length is
  // almost always a credential.
  /\b(?=[A-Za-z0-9]*[A-Z])(?=[A-Za-z0-9]*[a-z])(?=[A-Za-z0-9]*[0-9])[A-Za-z0-9]{32,}\b/g,
  // Our own stored-key envelope: `v1.<iv>.<tag>.<ciphertext>`, all base64.
  // Ciphertext is not usable without the encryption secret, but it has no
  // business in a third-party error tracker either, and its presence in a
  // report is itself a signal something is logging the wrong object.
  /\bv[123]\.[A-Za-z0-9+/=]{12,}\.[A-Za-z0-9+/=]{20,}\.[A-Za-z0-9+/=]{8,}/g,
  // Supabase's newer secret keys (the replacement for the service-role JWT;
  // this project still uses the JWT, but a rotation can switch it).
  /\bsb_secret_[A-Za-z0-9_-]{16,}/g,
  // Supabase / JWT-shaped tokens, which includes the service-role key.
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];

const REDACTED = "[redacted]";

/** Keys whose *value* is replaced wholesale, whatever it looks like. */
const SENSITIVE_KEY_NAMES = new Set([
  "key",
  "apikey",
  "api_key",
  "api-key",
  "encrypted_key",
  "plaintext",
  "secret",
  "token",
  "access_token",
  "refresh_token",
  "password",
  "cookie",
  "set-cookie",
  "authorization",
  "x-api-key",
  "x-goog-api-key",
  "ai_key_encryption_secret",
  "ai_key_encryption_secret_previous",
  "supabase_service_role_key",
  "cron_secret",
  "sentry_auth_token",
]);

export function scrubString(value: string): string {
  let out = value;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

/**
 * Walks an arbitrary structure, redacting secrets in place-ish (returns a new
 * value; the input is not mutated).
 *
 * Depth-bounded because Sentry events nest deeply and can contain cycles once
 * a caught object has been attached to them -- an unbounded walk would either
 * hang or blow the stack inside the error handler, which is the worst possible
 * place to throw.
 */
export function scrubValue<T>(value: T, depth = 0): T {
  if (depth > 12) return value;

  if (typeof value === "string") return scrubString(value) as unknown as T;

  if (Array.isArray(value)) {
    return value.map((entry) => scrubValue(entry, depth + 1)) as unknown as T;
  }

  if (value && typeof value === "object") {
    // Dates, buffers and the like are left alone: walking them yields nothing
    // useful and copying them changes their type out from under Sentry.
    if (Object.getPrototypeOf(value) !== Object.prototype) return value;

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_NAMES.has(k.toLowerCase())
        ? REDACTED
        : scrubValue(v, depth + 1);
    }
    return out as unknown as T;
  }

  return value;
}

/**
 * Sentry `beforeSend` / `beforeSendTransaction` hook.
 *
 * Wrapped in its own try/catch: a throw here would happen inside Sentry's
 * error-reporting path, where it is both invisible and capable of losing the
 * report entirely. If scrubbing somehow fails, dropping the event is the safe
 * outcome -- an event we could not scrub is exactly the one not to send.
 */
export function scrubEvent<T>(event: T): T | null {
  try {
    return scrubValue(event);
  } catch {
    return null;
  }
}

/**
 * console.error with everything scrubbed first. Function logs go to the
 * hosting platform's log store (and become Sentry breadcrumbs), so on any
 * path that touches a provider -- where a body might echo a credential --
 * this is the only way to log. Errors are reduced to name + message: a stack
 * or an attached `cause` can carry request objects.
 */
export function logError(prefix: string, ...values: unknown[]): void {
  const safe = values.map((v) => {
    if (typeof v === "string") return scrubString(v);
    if (v instanceof Error) return scrubString(`${v.name}: ${v.message}`);
    try {
      return scrubString(JSON.stringify(v));
    } catch {
      return "[unloggable value]";
    }
  });
  console.error(prefix, ...safe);
}
