/**
 * Options for the Supabase session cookies, shared by every client that sets
 * them (the proxy, server components and the /api/auth routes), so they
 * can't drift.
 *
 * - sameSite "lax": one of the two things standing between a cross-site page
 *   and this app's cookie-authenticated API (the other is isCrossSite in
 *   src/proxy.ts).
 * - secure in production: the cookie is never sent over plain http, even on
 *   a first request typed without https:// (HSTS covers that too; this is the
 *   cookie's own guarantee). Off in development because localhost runs on
 *   http.
 * - httpOnly (security gaps pass, Phase 1b, G-4): no script on the page can
 *   read the session, so an XSS can no longer copy it out and take over the
 *   account. Possible because the browser no longer talks to Supabase at all:
 *   sign-in, sign-up, sign-out, password reset, resend and Google go through
 *   src/app/api/auth/*. Existing cookies switch over at their next refresh
 *   (the proxy rewrites them with these options), so nobody is signed out.
 *   A test fails if a browser Supabase client comes back
 *   (src/lib/supabase/no-browser-client.test.ts).
 *
 *   Kill switch: AUTH_COOKIE_HTTPONLY=false in the environment writes the
 *   cookies script-readable again, without a code change. Sign-in keeps
 *   working either way; only the protection is off.
 */
export const SESSION_COOKIE_OPTIONS = {
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  httpOnly: process.env.AUTH_COOKIE_HTTPONLY !== "false",
};
