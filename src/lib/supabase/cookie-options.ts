/**
 * Options for the Supabase session cookies, shared by every client that sets
 * them (the proxy, server components and the browser), so they can't drift.
 *
 * - sameSite "lax": one of the two things standing between a cross-site page
 *   and this app's cookie-authenticated API (the other is isCrossSite in
 *   src/proxy.ts).
 * - secure in production: the cookie is never sent over plain http, even on
 *   a first request typed without https:// (HSTS covers that too; this is the
 *   cookie's own guarantee). Off in development because localhost runs on
 *   http.
 * - NOT httpOnly, deliberately: the browser Supabase client reads the session
 *   from these cookies to refresh it. An XSS could therefore read them, which
 *   is why the enforcing nonce-based CSP (src/proxy.ts) is the control that
 *   matters for this cookie. Moving to httpOnly would need every browser-side
 *   Supabase call routed through the server first.
 */
export const SESSION_COOKIE_OPTIONS = {
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};
