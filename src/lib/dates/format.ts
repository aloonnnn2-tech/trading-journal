// Dates that render identically on the server and in the browser.
//
// **The bug this exists to prevent.** `new Date(x).toLocaleString()` with no
// arguments uses whichever locale the *runtime* is set to. Inside a client
// component that means Node formats the HTML one way and the browser hydrates
// it another -- observed on /reports as `05/09/2026, 17:05:23` from the server
// against `9/5/2026, 5:05:23 PM` from the browser. React cannot reconcile
// that, so it throws a hydration error and regenerates the whole subtree,
// which the user sees as a flash of re-rendered content.
//
// It is invisible in a Server Component (that HTML is never re-rendered on the
// client, so the mismatch cannot arise) and invisible on a developer machine
// whose OS locale happens to match the deploy target. That combination is why
// it survived this long.
//
// The fix is a format with no locale in it at all: `5 Sep 2026` is the same
// string in every runtime, and unlike `9/5/2026` it cannot be read as either
// the 9th of May or the 5th of September depending on where the reader lives.

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * `5 Sep 2026`. Safe to render on both sides of a hydration boundary.
 *
 * Formatted from the *local* date parts, so it agrees with what the rest of
 * the app shows the trader -- everything user-facing in this app buckets by
 * their own calendar day rather than UTC's (see local-day.ts).
 */
export function formatDate(value: string | Date | null | undefined): string {
  if (value == null) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * `5 Sep 2026, 17:05`. 24-hour on purpose: am/pm is itself locale-dependent
 * wording, which is the thing being avoided here.
 */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (value == null) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${formatDate(date)}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
