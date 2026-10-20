import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Deleting an account needs proof the person has the account's inbox
// (2026-10-20). Asking to delete stores the SHA-256 of a fresh random code in
// account_deletion_requests (0076/0077) and emails a link ending in that code
// (/account/delete/confirm/<code>). Only the email ever holds the code: it
// goes from our server to Supabase's mailer and is never sent to the browser
// that asked. The delete only goes through when:
//
//   1. the person is signed in as the account,
//   2. that account has a request, not expired (one hour), and
//   3. the code in the link matches it.
//
// So a stolen session, or a script running in the page, can ask for
// deletion but can never finish it: that takes the email. Unlike the first
// version (which needed the link's own sign-in), the link works in any
// browser, from any device, and a mail scanner opening it first harms
// nothing -- the page only deletes when its button is pressed.

/** How long the emailed link is good for. */
export const DELETION_WINDOW_MS = 60 * 60_000;

/** base64url of 32 random bytes: no "." or "/", so Supabase's `*` matches it. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function newDeletionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashDeletionToken(token) };
}

export function hashDeletionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isDeletionTokenShape(token: unknown): token is string {
  return typeof token === "string" && TOKEN_SHAPE.test(token);
}

export interface DeletionRequest {
  requested_at: string;
  expires_at: string;
  token_hash: string | null;
}

export type DeletionProof =
  | { ok: true }
  | { ok: false; reason: "no_request" | "expired" | "wrong_link" | "unavailable" };

/** The rule, on its own, so it can be tested without a database. */
export function checkDeletionProof(request: DeletionRequest | null, token: unknown, now = Date.now()): DeletionProof {
  if (!request || !request.token_hash) return { ok: false, reason: "no_request" };
  const expiresAt = Date.parse(request.expires_at);
  if (!Number.isFinite(expiresAt)) return { ok: false, reason: "no_request" };
  if (now > expiresAt) return { ok: false, reason: "expired" };
  if (!isDeletionTokenShape(token)) return { ok: false, reason: "wrong_link" };
  const expected = Buffer.from(request.token_hash, "hex");
  const actual = Buffer.from(hashDeletionToken(token), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual)
    ? { ok: true }
    : { ok: false, reason: "wrong_link" };
}

/**
 * Reads this account's request (service role: the table has no user access;
 * keyed by the VERIFIED user id, never by anything in the URL) and applies
 * the rule to the code from the link.
 */
export async function deletionProof(admin: SupabaseClient, userId: string, token: unknown): Promise<DeletionProof> {
  const { data, error } = await admin
    .from("account_deletion_requests")
    .select("requested_at, expires_at, token_hash")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { ok: false, reason: "unavailable" };
  return checkDeletionProof((data as DeletionRequest | null) ?? null, token);
}

export const PROOF_MESSAGES: Record<Exclude<DeletionProof, { ok: true }>["reason"], string> = {
  no_request: "There's no deletion request for this account. Start again from the Account page.",
  expired: "That deletion link has expired. Ask for a new one from the Account page.",
  wrong_link:
    "That link isn't the current one for this account. Use the link in the newest email, signed in as the account it was sent to.",
  unavailable: "Account deletion isn't available right now. Try again in a minute.",
};
