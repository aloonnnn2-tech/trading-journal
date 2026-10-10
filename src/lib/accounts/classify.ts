/**
 * Sorts an account into a cleanup group by its email (hardening brief, final
 * task). Used by scripts/list-accounts.ts; kept here so it is unit-tested.
 *
 *   keep   the owner's accounts and the demo showcase account
 *   test   an address no person can receive mail at: a reserved test domain
 *          (.test, .invalid, .example, .localhost; RFC 2606), the same rule
 *          the admin analytics already use (0044); or the app's own
 *          domain, which only this project's scripts ever sign up with
 *          (tour-check-1@, demo-flow-yes@ ... were made by verification
 *          scripts; the demo account is the one deliberate exception)
 *   check  looks like a test account but is on a real domain; a person
 *          decides, never a script
 *   real   everything else; never a cleanup candidate
 */
export type AccountGroup = "keep" | "test" | "check" | "real";

export const KEEP_EMAILS: ReadonlySet<string> = new Set([
  "alonilon2018@gmail.com",
  "aloonnnn2@gmail.com",
  "demo@tradinglens.app",
]);

const RESERVED_TLD = /@[^@]+\.(test|invalid|example|localhost)$/i;
const OWN_DOMAIN = /@tradinglens\.app$/i;
const THROWAWAY_DOMAINS =
  /@(example\.(com|org|net)|mailinator\.com|yopmail\.com|guerrillamail\.[a-z]+|10minutemail\.[a-z]+|tempmail\.[a-z]+)$/i;
const TESTY_LOCAL = /^(e2e|test|tester|testing|probe|demo|fake|dummy|qa)([+._-]|\d|$)/i;

export function accountGroup(email: string | null | undefined): AccountGroup {
  const e = (email ?? "").trim().toLowerCase();
  if (KEEP_EMAILS.has(e)) return "keep";
  if (!e) return "check";
  if (RESERVED_TLD.test(e) || OWN_DOMAIN.test(e)) return "test";
  if (THROWAWAY_DOMAINS.test(e) || TESTY_LOCAL.test(e.split("@")[0])) return "check";
  return "real";
}

/** "ab***@domain": enough to recognise an account, not to mail it. */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "(no email)";
  const at = email.lastIndexOf("@");
  if (at < 0) return "***";
  return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`;
}
