import { createHmac, timingSafeEqual } from "node:crypto";
import { SITE_URL } from "@/lib/site";

/**
 * The unsubscribe link in onboarding emails: /unsubscribe?u=<user id>&t=<token>.
 * The token is an HMAC of the user id, so a link opts out only the account it
 * was sent to and cannot be made up for anyone else. Keyed off CRON_SECRET
 * (already set wherever the sender runs) with its own label, so the token
 * says nothing about the secret and cannot be reused elsewhere.
 */
function tokenFor(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(`unsubscribe-onboarding:${userId}`).digest("base64url");
}

export function unsubscribeToken(userId: string, secret: string): string {
  return tokenFor(userId, secret);
}

export function verifyUnsubscribeToken(userId: string, token: string, secret: string): boolean {
  if (!userId || !token || !secret) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(tokenFor(userId, secret));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function unsubscribeUrl(userId: string, secret: string): string {
  const q = new URLSearchParams({ u: userId, t: tokenFor(userId, secret) });
  return `${SITE_URL}/unsubscribe?${q.toString()}`;
}

/** Where the mailbox's one-click "Unsubscribe" button posts (RFC 8058). */
export function oneClickUnsubscribeUrl(userId: string, secret: string): string {
  const q = new URLSearchParams({ u: userId, t: tokenFor(userId, secret) });
  return `${SITE_URL}/api/email/unsubscribe?${q.toString()}`;
}
