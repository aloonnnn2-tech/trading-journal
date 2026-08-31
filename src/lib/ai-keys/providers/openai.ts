import { PROVIDER_MODELS } from "../types";
import { createOpenAICompatibleProvider } from "./openai-compatible";

// The four providers that speak OpenAI's REST shape. Each is base URL +
// model, not a separate integration -- see openai-compatible.ts. Models come
// from PROVIDER_MODELS so the setup UI names the same one that gets asked.

export const openaiProvider = createOpenAICompatibleProvider({
  name: "openai",
  baseUrl: "https://api.openai.com/v1",
  model: PROVIDER_MODELS.openai,
});

// Free tier, and by some distance the fastest of these.
export const groqProvider = createOpenAICompatibleProvider({
  name: "groq",
  baseUrl: "https://api.groq.com/openai/v1",
  model: PROVIDER_MODELS.groq,
});

// A gateway rather than a lab: one key reaches many models.
export const openrouterProvider = createOpenAICompatibleProvider({
  name: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  model: PROVIDER_MODELS.openrouter,
  // Optional attribution headers OpenRouter uses to identify calling apps.
  // Harmless if ignored, and they make this app's traffic legible in the
  // user's own OpenRouter dashboard rather than showing up as anonymous.
  headers: {
    "HTTP-Referer": "https://github.com/trading-journal",
    "X-Title": "Trading Journal",
  },
});

// Free tier with very fast inference on their own hardware.
export const cerebrasProvider = createOpenAICompatibleProvider({
  name: "cerebras",
  baseUrl: "https://api.cerebras.ai/v1",
  model: PROVIDER_MODELS.cerebras,
});
