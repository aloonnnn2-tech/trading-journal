import type { AIProviderName } from "@/lib/ai-keys/types";

// Its own module, free of zod, because the "Read with AI" panel needs it and
// that panel is reachable from the phone tab bar on every page: importing it
// from ./ai-extract shipped zod (about 51 KB compressed) to every page,
// homepage and sign-in included (full check, 2026-10-12).

/** Providers whose configured models can read images (see types.ts in
 *  ai-keys for the model lists). Groq, Cerebras and SambaNova's chosen
 *  models are text-only, so they are never offered this. */
export const SCREENSHOT_AI_PROVIDERS: ReadonlySet<AIProviderName> = new Set([
  "openai",
  "anthropic",
  "google",
  "mistral",
  "openrouter",
]);
