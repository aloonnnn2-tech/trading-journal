/** Must stay in sync with 0030's `check (provider in (...))`. */
export const AI_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "groq",
  "openrouter",
  "cerebras",
] as const;

export type AIProviderName = (typeof AI_PROVIDERS)[number];

export const PROVIDER_LABELS: Record<AIProviderName, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google AI Studio",
  groq: "Groq",
  openrouter: "OpenRouter",
  cerebras: "Cerebras",
};

/**
 * The model each provider is asked by default.
 *
 * Lives here rather than beside the provider implementations so the key-setup
 * UI can name the model without importing the provider registry -- that would
 * pull server-side integration code into the browser bundle, and would break
 * the client build the moment any provider file gained a server-only import.
 * The providers read these same constants, so there is still one source of
 * truth.
 *
 * These are the one part of this feature that goes stale on someone else's
 * schedule: a provider retiring a model surfaces as a failed question, not a
 * failed build. Each is a one-line change.
 */
export const PROVIDER_MODELS: Record<AIProviderName, string> = {
  // Cost-optimized: these run on the user's own key and their own bill, and
  // answering questions over an already-summarized journal context is not a
  // hard reasoning task.
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-5",
  google: "gemini-2.0-flash",
  // Verified against Groq's live /models list for this app. Groq retired the
  // Llama 3.x chat models; this is a reasoning model, so MAX_ANSWER_TOKENS
  // must stay generous enough for it to think *and* answer.
  groq: "openai/gpt-oss-120b",
  // The `:free` suffix pins the no-cost variant. Without it the same id bills
  // the user's OpenRouter credit -- a surprise for someone who came here
  // specifically for a free option. Verified against OpenRouter's public
  // /models list; the previous Llama 3.3 default had been retired.
  openrouter: "google/gemma-4-31b-it:free",
  cerebras: "llama-3.3-70b",
};

/**
 * Providers whose free tier is enough to actually use this feature without
 * paying anything, surfaced in the setup UI so a user who doesn't want a
 * billed account knows where to start.
 *
 * "Free tier" here means a standing allowance, not trial credits that expire
 * -- which is why Mistral and Together aren't on this list, and why OpenAI
 * and Anthropic (pay-as-you-go from the first token) aren't either.
 */
export const FREE_TIER_PROVIDERS: ReadonlySet<AIProviderName> = new Set([
  "groq",
  "openrouter",
  "cerebras",
  "google",
]);

/**
 * A saved key as the client is ever allowed to see it.
 *
 * There is deliberately no `encrypted_key` field and no plaintext field. This
 * is the *only* shape any endpoint returns for a stored key -- if a future
 * change needs to add something here, check first that it isn't secret. The
 * decrypted value never leaves the server after creation.
 */
export interface StoredApiKey {
  id: string;
  provider: AIProviderName;
  label: string | null;
  last_four: string;
  is_active: boolean;
  created_at: string;
  last_validated_at: string | null;
}
