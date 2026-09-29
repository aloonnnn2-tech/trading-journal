/**
 * Compares this app's AI model choices (PROVIDER_MODEL_CHOICES in
 * src/lib/ai-keys/types.ts) against each provider's LIVE model list.
 *
 * Providers retire models on their own schedule, and nothing in a build or a
 * test catches it -- four defaults went stale that way before the app learned
 * to fall back to the next choice on its own. The fallback keeps Ask working,
 * but a first choice that is gone means every key is running on a second
 * choice nobody picked on purpose, and a provider with NO live choice left is
 * broken for new keys. This script is how to notice either before a user does.
 *
 * Lists that are public are fetched with no key (OpenRouter, SambaNova). The
 * rest need a key, read from the environment if present, and are skipped
 * otherwise:
 *   OPENAI_API_KEY  ANTHROPIC_API_KEY  GEMINI_API_KEY  GROQ_API_KEY
 *   CEREBRAS_API_KEY  MISTRAL_API_KEY  SAMBANOVA_API_KEY  OPENROUTER_API_KEY
 * Keys are only sent to their own provider's /models endpoint (zero tokens).
 *
 * Run with:
 *   npm run check:ai-models
 *
 * Exit codes: 0 all checked first choices live; 1 a first choice is gone or a
 * provider has no live choice (update PROVIDER_MODEL_CHOICES).
 */
import { getProvider } from "../src/lib/ai-keys/providers";
import {
  chooseModel,
  extractModelIds,
  findOn,
} from "../src/lib/ai-keys/providers/model-check";
import {
  PROVIDER_MODEL_CHOICES,
  SELECTABLE_PROVIDERS,
  type AIProviderName,
} from "../src/lib/ai-keys/types";

const PUBLIC_LISTS: Partial<Record<AIProviderName, string>> = {
  openrouter: "https://openrouter.ai/api/v1/models",
  sambanova: "https://api.sambanova.ai/v1/models",
};

const KEY_ENV: Record<AIProviderName, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  mistral: "MISTRAL_API_KEY",
  sambanova: "SAMBANOVA_API_KEY",
  github: "GITHUB_MODELS_TOKEN",
};

async function liveModels(
  provider: AIProviderName,
): Promise<string[] | "skipped"> {
  const key = process.env[KEY_ENV[provider]];
  if (key) {
    const check = await getProvider(provider).validateKey(key);
    if (!check.valid) throw new Error(`${KEY_ENV[provider]} was rejected`);
    return check.models;
  }
  const url = PUBLIC_LISTS[provider];
  if (!url) return "skipped";
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return extractModelIds(await res.json(), provider);
}

// tsx runs this as CommonJS, which has no top-level await.
void main();

async function main() {
  let failed = false;
  for (const provider of SELECTABLE_PROVIDERS) {
    const choices = PROVIDER_MODEL_CHOICES[provider];
    let models: string[] | "skipped";
    try {
      models = await liveModels(provider);
    } catch (err) {
      console.log(
        `?  ${provider.padEnd(11)} couldn't check: ${err instanceof Error ? err.message : err}`,
      );
      continue;
    }
    if (models === "skipped") {
      console.log(
        `-  ${provider.padEnd(11)} skipped (set ${KEY_ENV[provider]} to check)`,
      );
      continue;
    }
    if (models.length === 0) {
      console.log(`?  ${provider.padEnd(11)} list was empty or unreadable`);
      continue;
    }
    const picked = chooseModel(provider, models);
    const gone = choices.filter((c) => !findOn(c, models));
    if (!picked) {
      failed = true;
      console.log(
        `x  ${provider.padEnd(11)} NONE of ${choices.join(", ")} is live -- new keys will be refused`,
      );
    } else if (picked !== findOn(choices[0], models)) {
      failed = true;
      console.log(
        `!  ${provider.padEnd(11)} first choice ${choices[0]} is gone; keys fall back to ${picked}`,
      );
    } else {
      console.log(
        `ok ${provider.padEnd(11)} ${picked}${gone.length ? `   (retired from the list: ${gone.join(", ")})` : ""}`,
      );
    }
  }

  if (failed) {
    console.log("\nUpdate PROVIDER_MODEL_CHOICES in src/lib/ai-keys/types.ts.");
    process.exit(1);
  }
}
