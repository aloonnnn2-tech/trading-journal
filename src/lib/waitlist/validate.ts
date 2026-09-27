import { z } from "zod";

// What POST /api/waitlist accepts, decided without touching the network or
// the database, so every branch is testable (validate.test.ts).
//
// Three outcomes, not two, because a bot and a person need different answers
// from the same form:
//  - "store": a person, with a real-looking address from a form we know.
//  - "honeypot": the hidden `website` field was filled. People never see it;
//    form-filling bots fill everything. The route answers exactly as it does
//    for a real signup and stores nothing, so the bot learns nothing.
//  - "invalid": a person with a typo, who needs to be told.
//
// Spam protection is this honeypot plus the route's rate limit, not
// Turnstile. Turnstile runs on the auth pages, but its tokens are verified by
// Supabase with a secret held only in the Supabase dashboard, so this server
// cannot check one without a new secret kept in sync between .env.local and
// Netlify. Alon chose this fallback on 2026-09-27; the spec allows it.

import { HONEYPOT_FIELD, MAX_EMAIL_LENGTH, WAITLIST_SOURCES, type WaitlistSource } from "./constants";

export { HONEYPOT_FIELD, MAX_EMAIL_LENGTH, WAITLIST_SOURCES, type WaitlistSource };

export type WaitlistRequest =
  | { kind: "store"; email: string; source: WaitlistSource }
  | { kind: "honeypot" }
  | { kind: "invalid"; reason: "email" | "source" | "body" };

const emailSchema = z.email();

export function parseWaitlistRequest(body: unknown): WaitlistRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { kind: "invalid", reason: "body" };
  }
  const fields = body as Record<string, unknown>;

  // Checked first: a bot that filled the trap is treated as a bot however
  // good the rest of its submission looks.
  const trap = fields[HONEYPOT_FIELD];
  if (typeof trap === "string" && trap.trim() !== "") return { kind: "honeypot" };

  const source = fields.source;
  if (typeof source !== "string" || !(WAITLIST_SOURCES as readonly string[]).includes(source)) {
    return { kind: "invalid", reason: "source" };
  }

  if (typeof fields.email !== "string") return { kind: "invalid", reason: "email" };
  const email = fields.email.trim();
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return { kind: "invalid", reason: "email" };
  if (!emailSchema.safeParse(email).success) return { kind: "invalid", reason: "email" };

  return { kind: "store", email, source: source as WaitlistSource };
}
