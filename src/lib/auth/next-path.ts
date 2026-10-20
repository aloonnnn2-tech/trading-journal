// Where sign-in may send someone afterwards. A fixed list, never whatever the
// URL says: "?next=//evil.example" must not turn sign-in into a redirect to
// another site. Anything else goes to the dashboard as before.
// /reset-password: a recovery email can arrive through /auth/callback (see
// src/app/auth/confirm/page.tsx) and must still land on the new-password form.
const ALLOWED_NEXT = new Set(["/review", "/reset-password"]);

// The emailed account-deletion link (2026-10-20), so someone who opens it
// signed out can sign in and land back on it. Exactly that shape: the page
// re-checks the code before anything can be deleted.
const DELETE_LINK = /^\/account\/delete\/confirm\/[A-Za-z0-9_-]{43}$/;

export function afterSignIn(next: string | null | undefined): string {
  return next && (ALLOWED_NEXT.has(next) || DELETE_LINK.test(next)) ? next : "/dashboard";
}
