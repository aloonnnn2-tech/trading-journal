import type { SupabaseClient } from "@supabase/supabase-js";

// Deleting an account needs proof the person has the account's inbox
// (2026-10-20). Asking to delete writes a row in account_deletion_requests
// (0076) and emails a link; opening the link signs the person in, and
// Supabase records that sign-in in the session's `amr` claim as method
// "otp" with its time (checked on the dev project). The delete only goes
// through when:
//
//   1. there is a request for this account, and it hasn't expired;
//   2. the CURRENT session was signed in from an emailed link, AFTER that
//      request was made.
//
// So a stolen session, or a script running in the page, can ask for
// deletion but can never finish it: that takes the email.

/** How long the emailed link is good for. */
export const DELETION_WINDOW_MS = 60 * 60_000;

/** Clock difference allowed between the database and Supabase Auth. */
const SKEW_MS = 5_000;

/** How an emailed-link sign-in shows up in `amr`. */
const EMAIL_LINK_METHODS = new Set(["otp", "magiclink"]);

export interface DeletionRequest {
  requested_at: string;
  expires_at: string;
}

export type DeletionProof =
  | { ok: true }
  | { ok: false; reason: "no_request" | "expired" | "needs_link" | "unavailable" };

/** Times (ms) the session was signed in from an emailed link. */
export function emailLinkSignIns(amr: unknown): number[] {
  if (!Array.isArray(amr)) return [];
  return amr.flatMap((entry) => {
    const { method, timestamp } = (entry ?? {}) as { method?: unknown; timestamp?: unknown };
    return typeof method === "string" && EMAIL_LINK_METHODS.has(method) && typeof timestamp === "number"
      ? [timestamp * 1000]
      : [];
  });
}

/** The rule, on its own, so it can be tested without a database. */
export function checkDeletionProof(request: DeletionRequest | null, amr: unknown, now = Date.now()): DeletionProof {
  if (!request) return { ok: false, reason: "no_request" };
  const requestedAt = Date.parse(request.requested_at);
  const expiresAt = Date.parse(request.expires_at);
  if (!Number.isFinite(requestedAt) || !Number.isFinite(expiresAt)) return { ok: false, reason: "no_request" };
  if (now > expiresAt) return { ok: false, reason: "expired" };
  const fresh = emailLinkSignIns(amr).some((at) => at >= requestedAt - SKEW_MS && at <= now + SKEW_MS);
  return fresh ? { ok: true } : { ok: false, reason: "needs_link" };
}

/**
 * Reads this account's request (service role: the table has no user access)
 * and the current session's verified claims (getClaims checks the token's
 * signature), and applies the rule.
 */
export async function deletionProof(userClient: SupabaseClient, admin: SupabaseClient, userId: string): Promise<DeletionProof> {
  const [{ data: row, error }, claims] = await Promise.all([
    admin.from("account_deletion_requests").select("requested_at, expires_at").eq("user_id", userId).maybeSingle(),
    userClient.auth.getClaims(),
  ]);
  if (error) return { ok: false, reason: "unavailable" };
  const verified = claims.data?.claims;
  if (claims.error || !verified || verified.sub !== userId) return { ok: false, reason: "needs_link" };
  return checkDeletionProof((row as DeletionRequest | null) ?? null, verified.amr);
}

export const PROOF_MESSAGES: Record<Exclude<DeletionProof, { ok: true }>["reason"], string> = {
  no_request: "There's no deletion request for this account. Start again from the Account page.",
  expired: "That deletion link has expired. Ask for a new one from the Account page.",
  needs_link: "To delete your account, open the link we emailed you. The account is only deleted from that link.",
  unavailable: "Account deletion isn't available right now. Try again in a minute.",
};
