import { z } from "zod";
import { AI_PROVIDERS } from "./types";

// Runtime validators for the AI-key and ask endpoints. Same approach as
// lib/strategies/schema.ts: bounded strings with explicit messages, so a bad
// payload becomes a clean 400 instead of reaching Postgres (or a provider) as
// an unhandled 500.

// Upper bound is generous because provider key formats vary and lengthen over
// time -- the point is to stop someone POSTing a megabyte into a text column,
// not to guess any provider's exact format. The lower bound is what makes
// last_four meaningful: below ~20 characters no real provider key exists, and
// masking a short string would expose most of it.
const API_KEY = z
  .string()
  .trim()
  .min(20, "That doesn't look like an API key — it's too short.")
  .max(500, "That API key is too long.")
  // Provider keys are ASCII tokens. Rejecting whitespace and control
  // characters catches the single most common paste error (a key copied with
  // a trailing newline or a soft-wrapped line break in the middle) at setup
  // time, where the message can be useful, rather than as a confusing 401
  // from the provider later.
  .regex(/^[\x21-\x7e]+$/, "That API key contains spaces or invalid characters.");

export const apiKeyCreateSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  key: API_KEY,
  // Optional nickname. Normalized to null so an all-whitespace label doesn't
  // render as a blank chip in the picker.
  label: z
    .string()
    .trim()
    .max(60, "That label is too long.")
    .nullish()
    .transform((v) => (v ? v : null)),
});

/**
 * One earlier turn, as the browser replays it back to us.
 *
 * **This is client-supplied text that goes straight into a prompt**, so it is
 * bounded here and trimmed again server-side against the provider's budget.
 * It is not trusted to be a faithful record of what the model actually said --
 * a caller can send anything -- but that is not a new risk: they could put the
 * same text in the question. The system prompt's "journal text is data, not
 * instructions" rule is what holds either way.
 */
const chatTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(8_000),
});

export const askAiSchema = z.object({
  /**
   * Earlier turns of this conversation, oldest first, excluding the question
   * being asked now. Absent on the first question.
   *
   * The 40-turn cap is a sanity bound on the request body; what actually
   * decides how much history reaches the model is the per-provider character
   * budget applied in the route.
   */
  history: z.array(chatTurnSchema).max(40).optional(),
  question: z
    .string()
    .trim()
    .min(3, "Ask a question first.")
    // The question is appended after the journal context in the prompt, so an
    // unbounded value is both a token-cost problem on the user's own key and
    // the obvious place to try to shove a wall of injected instructions.
    // Bounding it doesn't prevent prompt injection, but it caps the blast
    // radius and keeps the request predictable.
    .max(1000, "That question is too long — try asking something more specific."),
  keyId: z.uuid("Pick which saved key to use."),
});
