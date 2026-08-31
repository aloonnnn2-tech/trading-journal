import { PROVIDER_MODELS } from "../types";
import { assertModelAvailable } from "./model-check";
import {
  ASK_TIMEOUT_MS,
  ProviderError,
  VALIDATE_TIMEOUT_MS,
  errorDetail,
  failureFromStatus,
  providerFetch,
  type AIProvider,
} from "./types";

const BASE = "https://api.anthropic.com/v1";

// Pinned wire version. Anthropic requires this header on every request and
// uses it to keep response shapes stable, so it must not be omitted or
// floated -- a future breaking change lands only when this is bumped
// deliberately.
const API_VERSION = "2023-06-01";

// Cost-optimized default, on the user's own key and bill. Shared with the
// setup UI via PROVIDER_MODELS so both name the same model.
const MODEL = PROVIDER_MODELS.anthropic;

// Larger than the other providers' answer cap on purpose: on this model
// max_tokens bounds thinking *plus* the visible reply, and thinking is on by
// default. Sizing this to the answer alone would truncate mid-sentence once
// the model thought for any length. `effort: low` is what actually keeps the
// spend down; this is just headroom so the reply can finish.
const MAX_TOKENS = 4000;

export const anthropicProvider: AIProvider = {
  name: "anthropic",
  model: MODEL,

  async validateKey(apiKey: string): Promise<boolean> {
    // Listing models is the zero-token way to check a key.
    const res = await providerFetch(
      `${BASE}/models`,
      { headers: { "x-api-key": apiKey, "anthropic-version": API_VERSION } },
      VALIDATE_TIMEOUT_MS,
    );

    if (res.status === 401 || res.status === 403) return false;
    if (!res.ok) throw new ProviderError("unavailable", await errorDetail(res));

    // Reuses the response already fetched to test the key -- see model-check.ts.
    await assertModelAvailable(res, MODEL, "anthropic");
    return true;
  },

  async askQuestion(apiKey: string, systemPrompt: string, question: string): Promise<string> {
    const res = await providerFetch(
      `${BASE}/messages`,
      {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": API_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          // Low effort keeps the token spend down on what is, by this point,
          // a question against a pre-summarized context rather than an
          // open-ended reasoning task.
          output_config: { effort: "low" },
          // `system` is a top-level parameter here, not a message role.
          system: systemPrompt,
          messages: [{ role: "user", content: question }],
        }),
      },
      ASK_TIMEOUT_MS,
    );

    if (!res.ok) {
      throw new ProviderError(failureFromStatus(res.status), await errorDetail(res));
    }

    const json = await res.json();

    // A safety classifier can decline a request and still return HTTP 200,
    // with `content` empty. Checking stop_reason before reading content is
    // what stops that becoming a confusing empty answer.
    if (json?.stop_reason === "refusal") {
      throw new ProviderError(
        "failed",
        `refusal: ${JSON.stringify(json?.stop_details ?? null).slice(0, 200)}`,
      );
    }

    // content is a list of blocks and, with thinking on, the first one is NOT
    // the answer -- indexing [0] would return a thinking block (whose text is
    // empty by default) instead of the reply. Collect every text block.
    const blocks: unknown[] = Array.isArray(json?.content) ? json.content : [];
    const text = blocks
      .filter(
        (b): b is { type: string; text: string } =>
          typeof b === "object" &&
          b !== null &&
          (b as { type?: unknown }).type === "text" &&
          typeof (b as { text?: unknown }).text === "string",
      )
      .map((b) => b.text)
      .join("")
      .trim();

    if (text === "") {
      throw new ProviderError("failed", `empty message: ${JSON.stringify(json).slice(0, 300)}`);
    }
    return text;
  },
};
