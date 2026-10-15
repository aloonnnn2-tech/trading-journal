import type { EmailOtpType } from "@supabase/supabase-js";

// The parts of an emailed auth link (/auth/confirm?token_hash=...&type=...&next=...)
// that /auth/confirm and /auth/confirm/verify both need, checked the same way
// in both.

const OTP_TYPES: readonly EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

export function otpType(value: string | null | undefined): EmailOtpType | null {
  return OTP_TYPES.includes(value as EmailOtpType) ? (value as EmailOtpType) : null;
}

/**
 * Where to go after the link is used: only ever a path on this site.
 *
 * `next` arrives from the query string and is fed to `new URL(next, origin)`,
 * which happily accepts an absolute URL and returns it as-is -- so
 * `next=https://example.com` would send a freshly-signed-in user off the site.
 *
 * Resolve first, then compare origins. Prefix-checking the raw string for "/"
 * and not "//" looks equivalent and isn't: URL treats a backslash as a slash
 * under a special scheme, so `next=/\evil.com` passes that check and still
 * resolves to http://evil.com/. Only the resolved origin is trustworthy, and
 * the redirect reuses that resolved URL so nothing can differ between what
 * was checked and what is sent.
 */
export function safeDestination(requestedNext: string | null | undefined, origin: string): URL {
  const fallback = new URL("/dashboard", origin);
  if (!requestedNext) return fallback;
  try {
    const resolved = new URL(requestedNext, origin);
    return resolved.origin === origin ? resolved : fallback;
  } catch {
    return fallback;
  }
}
