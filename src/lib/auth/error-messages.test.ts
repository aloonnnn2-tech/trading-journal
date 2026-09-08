import { describe, expect, it } from "vitest";
import {
  AUTH_GENERIC_MESSAGE,
  AUTH_OFFLINE_MESSAGE,
  authErrorMessage,
  isEmailNotConfirmed,
} from "./error-messages";

/**
 * Shapes a Supabase AuthError closely enough for the mapper: a `code`, a
 * `status`, and the SDK's own `message` -- which is the thing that must never
 * come back out.
 */
function authError(code: string | undefined, message = "raw internal detail", status = 400) {
  return Object.assign(new Error(message), { code, status, name: "AuthApiError" });
}

describe("authErrorMessage", () => {
  it("maps a wrong password to something the reader can act on", () => {
    const msg = authErrorMessage(authError("invalid_credentials", "Invalid login credentials"));
    expect(msg).toBe("That email and password don't match an account. Check both and try again.");
  });

  it("maps a taken email to the sign-in suggestion", () => {
    expect(authErrorMessage(authError("email_exists"))).toContain("Try signing in instead");
    expect(authErrorMessage(authError("user_already_exists"))).toContain("Try signing in instead");
  });

  it("maps an expired recovery link to the recovery path", () => {
    expect(authErrorMessage(authError("otp_expired"))).toContain("Request a new one");
  });

  it("maps a rate limit to a wait-and-retry message", () => {
    expect(authErrorMessage(authError("over_request_rate_limit"))).toContain("Too many attempts");
  });

  // The auth screens call Supabase directly from the browser, so a dropped
  // connection is the single most likely failure after a typo -- and the one
  // most easily mistaken for a wrong password.
  it("reports a dead connection as a connection problem, not a credentials problem", () => {
    const fetchFailure = new TypeError("Failed to fetch");
    expect(authErrorMessage(fetchFailure)).toBe(AUTH_OFFLINE_MESSAGE);

    const wrapped = Object.assign(new Error("network request failed"), {
      name: "AuthRetryableFetchError",
    });
    expect(authErrorMessage(wrapped)).toBe(AUTH_OFFLINE_MESSAGE);
  });

  it("falls back on status when the code is one this SDK version doesn't know", () => {
    expect(authErrorMessage(authError("some_future_code", "whatever", 429))).toContain(
      "Too many attempts",
    );
    expect(authErrorMessage(authError("some_future_code", "whatever", 503))).toContain(
      "problem on our end",
    );
  });

  it("falls back to the generic message for anything unrecognised", () => {
    expect(authErrorMessage(authError(undefined, "boom", 400))).toBe(AUTH_GENERIC_MESSAGE);
    expect(authErrorMessage(null)).toBe(AUTH_GENERIC_MESSAGE);
    expect(authErrorMessage({})).toBe(AUTH_GENERIC_MESSAGE);
    expect(authErrorMessage("a bare string")).toBe(AUTH_GENERIC_MESSAGE);
  });

  // The contract the whole module exists for. If this ever fails, an internal
  // detail is reaching the sign-in screen.
  it("never passes the SDK's own message through, mapped or not", () => {
    const sensitive =
      'PGRST301: JWT expired at row "auth.users" -- key sk-live-abc123 rejected by gotrue';
    const cases = [
      authError("invalid_credentials", sensitive),
      authError("some_future_code", sensitive),
      authError(undefined, sensitive),
      authError("unexpected_failure", sensitive, 500),
      new Error(sensitive),
    ];

    for (const error of cases) {
      const msg = authErrorMessage(error);
      expect(msg).not.toContain("PGRST");
      expect(msg).not.toContain("sk-live");
      expect(msg).not.toContain("auth.users");
      expect(msg).not.toContain("gotrue");
      expect(msg).not.toContain(sensitive);
    }
  });

  it("always returns a non-empty sentence", () => {
    for (const error of [null, undefined, {}, new Error(""), authError("invalid_credentials")]) {
      const msg = authErrorMessage(error);
      expect(msg.length).toBeGreaterThan(0);
      expect(msg.trim()).toBe(msg);
    }
  });
});

describe("isEmailNotConfirmed", () => {
  it("recognises the unconfirmed-account code", () => {
    expect(isEmailNotConfirmed(authError("email_not_confirmed"))).toBe(true);
  });

  it("does not fire on other failures", () => {
    expect(isEmailNotConfirmed(authError("invalid_credentials"))).toBe(false);
    expect(isEmailNotConfirmed(null)).toBe(false);
    // Guards the old substring match: this message says "not confirmed" but
    // carries a different code, and must not offer a resend that won't help.
    expect(isEmailNotConfirmed(authError("user_banned", "account not confirmed"))).toBe(false);
  });
});
