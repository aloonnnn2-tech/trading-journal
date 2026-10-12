// Shared by the waitlist form (browser) and its validation (server). Kept in
// a file of its own, free of imports, so the form does not pull zod into the
// homepage's client bundle just to learn a field name.

/** Longest valid address: RFC 5321's 256-octet path, minus the angle brackets.
 *  The migration's check constraint is the floor under this. */
export const MAX_EMAIL_LENGTH = 254;

/** Every form that may write to the waitlist. A fixed list, so a bot cannot
 *  put free text into the `source` column. */
// "app-plans-panel": a signed-in free user, from a "See plans" button.
export const WAITLIST_SOURCES = ["home-paid-card", "app-plans-panel"] as const;
export type WaitlistSource = (typeof WAITLIST_SOURCES)[number];

/** The hidden honeypot field's name. Something a bot's autofill wants to answer. */
export const HONEYPOT_FIELD = "website";
