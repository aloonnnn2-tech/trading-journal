/** Must stay in sync with 0030's `check (provider in (...))`. */
export const AI_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "groq",
  "openrouter",
  "cerebras",
  "mistral",
  "sambanova",
  "github",
] as const;

export type AIProviderName = (typeof AI_PROVIDERS)[number];

/**
 * Providers that can no longer be used, kept in AI_PROVIDERS so historical
 * rows still resolve through getProvider() instead of crashing.
 *
 * GitHub Models began a retirement brownout: both endpoints this app uses
 * answer 410 with
 *   {"error":{"code":"github_models_retirement_brownout", ...}}
 * so a key can neither be validated nor used. Offering it produced a dead end
 * -- validateKey sees 410, classifies it "failed", and the save route tells
 * the user it is "a temporary outage, try again in a moment", which will never
 * come true. Do not re-add it without checking those endpoints first.
 */
export const RETIRED_PROVIDERS: ReadonlySet<AIProviderName> = new Set(["github"]);

/** The providers a user may actually pick. Everything user-facing uses this. */
export const SELECTABLE_PROVIDERS = AI_PROVIDERS.filter((p) => !RETIRED_PROVIDERS.has(p));

export const PROVIDER_LABELS: Record<AIProviderName, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google AI Studio",
  groq: "Groq",
  openrouter: "OpenRouter",
  cerebras: "Cerebras",
  mistral: "Mistral AI",
  sambanova: "SambaNova",
  github: "GitHub Models",
};

/**
 * The models this app will ask each provider for, best first.
 *
 * Lives here rather than beside the provider implementations so the key-setup
 * UI can name the model without importing the provider registry -- that would
 * pull server-side integration code into the browser bundle, and would break
 * the client build the moment any provider file gained a server-only import.
 *
 * These go stale on someone else's schedule: a provider retiring a model
 * surfaces as a failed question, not a failed build. It has happened four
 * times (Groq's Llama 3.x, OpenRouter's Llama 3.3, Cerebras' llama-3.3-70b,
 * Google's gemini-2.0-flash). So this is a LIST, not one id: when a key is
 * saved or tested, `chooseModel` (providers/model-check.ts) picks the first
 * entry the provider's live /models list still offers, stores it on the key,
 * and re-picks the same way if it disappears mid-conversation. One retired id
 * therefore degrades to the next choice instead of breaking Ask.
 *
 * `npm run check:ai-models` compares these against the live lists.
 * Last checked against the providers' live lists / docs: 2026-09-29.
 */
export const PROVIDER_MODEL_CHOICES: Record<AIProviderName, readonly string[]> = {
  // Cost-optimized: these run on the user's own key and their own bill, and
  // answering questions over an already-summarized journal context is not a
  // hard reasoning task.
  openai: ["gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini"],
  anthropic: ["claude-sonnet-5", "claude-haiku-4-5"],
  // gemini-2.0-flash was shut down on 2026-06-01.
  google: ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-flash-lite-latest", "gemini-flash-latest"],
  // Groq retired the Llama 3.x chat models; gpt-oss is a reasoning model, so
  // MAX_ANSWER_TOKENS must stay generous enough for it to think *and* answer.
  groq: ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"],
  // The `:free` suffix pins the no-cost variant. Without it the same id bills
  // the user's OpenRouter credit -- a surprise for someone who came here
  // specifically for a free option. Every choice here must keep it
  // (providers.test.ts enforces that).
  openrouter: [
    "google/gemma-4-31b-it:free",
    "qwen/qwen3.8-27b:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "google/gemma-4-26b-a4b-it:free",
  ],
  // Cerebras dropped llama-3.3-70b; its shared tier now serves only these two.
  cerebras: ["gpt-oss-120b", "qwen-3.8-27b"],
  // Mistral's free tier covers the small model; it supports tool calling, so
  // the agentic Ask path engages rather than falling back to the text dump.
  mistral: ["mistral-small-latest", "mistral-small-4", "mistral-medium-latest"],
  // Ids are capitalised exactly as SambaNova's /models list returns them --
  // the match is case-sensitive.
  sambanova: ["gpt-oss-120b", "DeepSeek-V3.2", "Meta-Llama-3.3-70B-Instruct"],
  // GitHub Models namespaces every model `publisher/model`, and the same
  // namespaced id is what the catalog lists and what /chat/completions wants.
  github: ["openai/gpt-4o-mini"],
};

/**
 * The first choice per provider: what a key uses until it has been checked
 * against the live list, and what the setup UI names before a key exists.
 */
export const PROVIDER_MODELS: Record<AIProviderName, string> = Object.fromEntries(
  AI_PROVIDERS.map((p) => [p, PROVIDER_MODEL_CHOICES[p][0]]),
) as Record<AIProviderName, string>;

/**
 * Providers whose free tier is enough to actually use this feature without
 * paying anything, surfaced in the setup UI so a user who doesn't want a
 * billed account knows where to start.
 *
 * "Free tier" here means a standing allowance, not trial credits that expire
 * -- which is why OpenAI and Anthropic (pay-as-you-go from the first token)
 * aren't on this list. Mistral is now included: it launched a genuine free
 * tier (rate-limited, phone-verified), no longer just trial credits. GitHub
 * Models is free with a GitHub token, and SambaNova has a standing free tier.
 */
export const FREE_TIER_PROVIDERS: ReadonlySet<AIProviderName> = new Set([
  "groq",
  "openrouter",
  "cerebras",
  "google",
  "mistral",
  "sambanova",
  // "github" was here until its retirement brownout -- see RETIRED_PROVIDERS.
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
  /**
   * The model this key asks, chosen from the provider's live list when the
   * key was saved or last tested. Null for keys saved before 0053, or while
   * 0053 isn't applied; those use PROVIDER_MODELS.
   */
  model: string | null;
  /** When the key was last sent to its provider (0058); null = not since. */
  last_used_at: string | null;
  is_active: boolean;
  created_at: string;
  last_validated_at: string | null;
}
