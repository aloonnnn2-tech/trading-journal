import { z } from "zod";
import { SELECTABLE_PROVIDERS } from "./types";

// Runtime validators for the AI-key endpoints. Same approach as
// lib/strategies/schema.ts: bounded strings with explicit messages, so a bad
// payload becomes a clean 400 instead of reaching Postgres (or a provider) as
// an unhandled 500. The chat's own body schema lives with its route
// (src/app/api/chat/conversations/[id]/turn/route.ts).

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
  // SELECTABLE, not every known provider: a retired one (GitHub Models) can
  // no longer validate a key, so accepting it here would save nothing and
  // report a "temporary outage" that never ends.
  provider: z.enum(SELECTABLE_PROVIDERS),
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
