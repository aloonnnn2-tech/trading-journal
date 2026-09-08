// Plain-English messages for Supabase Auth failures.
//
// **Why this exists.** Every auth screen used to render `error.message`
// straight from the SDK, so a mistyped password produced "Invalid login
// credentials" (developer shorthand, not an instruction) and a tripped rate
// limit produced "For security purposes, you can only request this after 47
// seconds" -- text written for whoever is reading a server log, not for
// someone trying to get into their journal. Worse, the message is whatever
// GoTrue happens to send, which means an internal detail can surface in the
// UI without anyone having chosen to put it there.
//
// So nothing here ever returns the SDK's own string. A code we recognise gets
// a message we wrote; anything else gets a safe generic. That is the whole
// contract, and the test file asserts it directly.
//
// Every message follows the same two-part shape the brief asks for: what
// happened, then what to do about it. A message that only names the failure
// leaves the reader exactly as stuck as no message would have.

import type { AuthError } from "@supabase/supabase-js";

const GENERIC = "Something went wrong. Please try again.";

const OFFLINE = "Couldn't reach Trading Lens. Check your internet connection and try again.";

/**
 * Keyed by Supabase's stable `code` field rather than by message text, which
 * is free to change between GoTrue releases and has done, without notice.
 *
 * Only codes reachable from this app's four auth screens (password sign-in,
 * sign-up, password recovery, and the confirmation resend) are listed. The
 * MFA/SAML/SMS/OAuth families are deliberately absent -- none of those
 * providers are enabled, so a message for them would be dead copy that still
 * has to be maintained.
 */
const MESSAGES: Record<string, string> = {
  // --- Sign in ---------------------------------------------------------
  invalid_credentials:
    "That email and password don't match an account. Check both and try again.",
  email_not_confirmed:
    "You haven't confirmed your email address yet. Use the link in your confirmation email, or send yourself a new one below.",
  user_not_found: "That email and password don't match an account. Check both and try again.",
  user_banned: "This account has been suspended. Contact support if you think that's a mistake.",

  // --- Sign up ---------------------------------------------------------
  // Both of these mean "this email is taken". Saying so plainly is not an
  // account disclosure worth agonising over here: sign-up already reveals it
  // by failing, and pretending otherwise leaves the person stuck on a form
  // that will never succeed.
  email_exists: "An account already exists for that email address. Try signing in instead.",
  user_already_exists:
    "An account already exists for that email address. Try signing in instead.",
  signup_disabled: "New sign-ups are closed at the moment. Please try again later.",
  email_provider_disabled: "Email sign-up isn't available right now. Please try again later.",
  email_address_invalid: "That doesn't look like a valid email address. Check it and try again.",
  email_address_not_authorized: "We can't send email to that address. Try a different one.",

  // --- Passwords -------------------------------------------------------
  weak_password:
    "That password is too easy to guess. Use at least 6 characters, and mix in something less common.",
  same_password: "That's already your current password. Choose a different one.",

  // --- Recovery / confirmation links -----------------------------------
  otp_expired: "That link has expired. Request a new one and use it within the hour.",
  flow_state_expired: "That link has expired. Request a new one and use it within the hour.",
  flow_state_not_found: "That link is no longer valid. Request a new one to continue.",
  session_expired: "Your session has expired. Please sign in again.",
  session_not_found: "Your session has expired. Please sign in again.",
  reauthentication_needed: "Please sign in again before changing your password.",

  // --- Rate limits -----------------------------------------------------
  // These are the user-facing half of the auth rate limiting documented in
  // SECURITY.md. The limits themselves live in the Supabase dashboard --
  // sign-in and sign-up talk to Supabase Auth directly from the browser and
  // never pass through this app's own server, so there is nowhere in this
  // codebase they could be enforced.
  over_request_rate_limit: "Too many attempts in a row. Wait a minute or two, then try again.",
  over_email_send_rate_limit:
    "We've sent several emails to that address already. Wait a few minutes before asking for another.",

  // --- Input the server rejected ---------------------------------------
  validation_failed: "Some of those details aren't valid. Check them and try again.",
  bad_json: GENERIC,

  // --- Server-side faults ----------------------------------------------
  unexpected_failure: "Trading Lens had a problem on our end. Please try again in a moment.",
  request_timeout: "That took too long to respond. Please try again.",
  captcha_failed: "The security check didn't pass. Reload the page and try again.",
};

function codeOf(error: unknown): string | undefined {
  const code = (error as Partial<AuthError> | null)?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * A failed `fetch` -- offline, DNS failure, connection reset -- rejects with a
 * TypeError carrying no status and no code, so it is indistinguishable from a
 * real auth failure unless it is checked for specifically. Telling someone
 * their password is wrong when their wi-fi dropped is the single most
 * misleading thing this module could do, which is why this is checked first.
 */
function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (!(error instanceof Error)) return false;
  // AuthRetryableFetchError is what the SDK wraps a dead connection in; a bare
  // TypeError is what surfaces when the failure escapes that wrapper.
  if (error.name === "AuthRetryableFetchError") return true;
  return error instanceof TypeError && /fetch|network/i.test(error.message);
}

/**
 * Turns any auth failure into something worth showing a person.
 *
 * Never returns the SDK's own message, on any path. An unrecognised code is a
 * gap in the table above, and the right response to a gap is a safe generic --
 * not a passthrough that leaks whatever the server happened to say.
 */
export function authErrorMessage(error: unknown): string {
  if (!error) return GENERIC;
  if (isNetworkError(error)) return OFFLINE;

  const code = codeOf(error);
  if (code && code in MESSAGES) return MESSAGES[code];

  // No code, or one this SDK version doesn't know yet. Status is the only
  // other signal that means anything consistent.
  const status = (error as { status?: number } | null)?.status;
  if (status === 429) return MESSAGES.over_request_rate_limit;
  if (typeof status === "number" && status >= 500) return MESSAGES.unexpected_failure;

  return GENERIC;
}

/**
 * Drives the "resend confirmation email" affordance on the sign-in screen.
 * Previously a substring match on the message text ("not confirmed"), which
 * silently stops working the day that wording changes -- and when it stops
 * working the account is a dead end: it exists, so signing up again fails
 * too, and the offer to resend is the only way out.
 */
export function isEmailNotConfirmed(error: unknown): boolean {
  return codeOf(error) === "email_not_confirmed";
}

export const AUTH_GENERIC_MESSAGE = GENERIC;
export const AUTH_OFFLINE_MESSAGE = OFFLINE;
