// Where sign-in may send someone afterwards. A fixed list, never whatever the
// URL says: "?next=//evil.example" must not turn sign-in into a redirect to
// another site. Anything else goes to the dashboard as before.
const ALLOWED_NEXT = new Set(["/review"]);

export function afterSignIn(next: string | null | undefined): string {
  return next && ALLOWED_NEXT.has(next) ? next : "/dashboard";
}
