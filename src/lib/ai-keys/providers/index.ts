import type { AIProviderName } from "../types";
import { anthropicProvider } from "./anthropic";
import { googleProvider } from "./google";
import { cerebrasProvider, groqProvider, openaiProvider, openrouterProvider } from "./openai";
import type { AIProvider } from "./types";

// Keyed by the same strings as 0030's provider check constraint and the zod
// enum, so a provider that validates is always a provider that resolves.
// Record<AIProviderName, ...> is what enforces that: adding a name to
// AI_PROVIDERS without wiring it up here is a type error, not a runtime 500.
const PROVIDERS: Record<AIProviderName, AIProvider> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  google: googleProvider,
  groq: groqProvider,
  openrouter: openrouterProvider,
  cerebras: cerebrasProvider,
};

export function getProvider(name: AIProviderName): AIProvider {
  return PROVIDERS[name];
}

/** Default model per provider, for display in the key-setup UI. */
export function providerModel(name: AIProviderName): string {
  return PROVIDERS[name].model;
}

export * from "./types";
