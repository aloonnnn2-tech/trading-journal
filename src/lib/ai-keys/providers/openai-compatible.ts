import type { AIProviderName } from "../types";
import { assertModelAvailable } from "./model-check";
import {
  ASK_TIMEOUT_MS,
  MAX_ANSWER_TOKENS,
  ProviderError,
  VALIDATE_TIMEOUT_MS,
  errorDetail,
  failureFromStatus,
  providerFetch,
  type AIProvider,
  type AskOptions,
} from "./types";

// One adapter for every provider that speaks OpenAI's REST shape: a Bearer
// token, `POST /chat/completions` taking a `messages` array, and `GET /models`
// as a zero-token liveness check. OpenAI, Groq, OpenRouter and Cerebras all
// do, so they differ only in base URL, default model, and a couple of
// optional headers -- five lines of configuration rather than five
// integrations to keep working.
//
// Deliberately not extended to Anthropic or Google: both have genuinely
// different request and response shapes, and bending them into this factory
// would produce more special-casing than the two separate files they have.

export interface OpenAICompatibleConfig {
  name: AIProviderName;
  /** Base URL including the version segment, no trailing slash. */
  baseUrl: string;
  model: string;
  /** Extra headers some providers want (e.g. OpenRouter's attribution). */
  headers?: Record<string, string>;
}

export function createOpenAICompatibleProvider(config: OpenAICompatibleConfig): AIProvider {
  const { name, baseUrl, model, headers = {} } = config;

  function auth(apiKey: string): Record<string, string> {
    return { Authorization: `Bearer ${apiKey}`, ...headers };
  }

  return {
    name,
    model,

    async validateKey(apiKey: string): Promise<boolean> {
      // Listing models costs no tokens, which matters because this runs on
      // every save attempt including the mistyped ones.
      const res = await providerFetch(
        `${baseUrl}/models`,
        { headers: auth(apiKey) },
        VALIDATE_TIMEOUT_MS,
      );

      if (res.status === 401 || res.status === 403) return false;
      if (!res.ok) {
        // Anything else means we never got a verdict. Treat it as "couldn't
        // check" rather than "bad key" -- rejecting a valid key because the
        // provider was briefly down would be a confusing dead end at setup.
        throw new ProviderError("unavailable", await errorDetail(res));
      }

      // The key works. While we have the model list in hand, confirm the model
      // this app is configured to ask for is actually on it. Providers retire
      // models on their own schedule and nothing here fails at build time, so
      // without this check a stale id is only discovered at question time --
      // reported as a vague provider failure, long after the user has stopped
      // associating it with adding the key.
      await assertModelAvailable(res, model, name);
      return true;
    },

    async askQuestion(
      apiKey: string,
      systemPrompt: string,
      question: string,
      options?: AskOptions,
    ): Promise<string> {
      const res = await providerFetch(
        `${baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: { ...auth(apiKey), "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            max_tokens: options?.maxTokens ?? MAX_ANSWER_TOKENS,
            // System prompt first, then earlier turns, then the current
            // question. Ordering matters: several of these providers weight
            // the final message most heavily, and burying the live question
            // mid-array makes follow-ups answer the wrong turn.
            messages: [
              { role: "system", content: systemPrompt },
              ...(options?.history ?? []),
              { role: "user", content: question },
            ],
          }),
        },
        options?.timeoutMs ?? ASK_TIMEOUT_MS,
      );

      if (!res.ok) {
        const detail = await errorDetail(res);
        // A retired or inaccessible model id is the single most likely way
        // this breaks over time -- providers drop models on their own
        // schedule and our default becomes stale with no build failure to
        // warn us. Classify it so the user is told exactly that instead of
        // being sent off to check a key that was never the problem.
        const missing =
          /model_not_found|does not exist|no such model|unknown model|model.*not found/i.test(
            detail,
          );
        throw new ProviderError(
          missing ? "model_missing" : failureFromStatus(res.status),
          detail,
        );
      }

      const json = await res.json();

      // Gateways in this family (OpenRouter especially) can return HTTP 200
      // with an `error` object in the body when an upstream model fails or a
      // free model is out of capacity. Reading `choices` first would surface
      // that as a blank answer instead of something actionable.
      if (json?.error) {
        const message = String(json.error?.message ?? json.error);
        // "No endpoints found" / "rate-limited" from a gateway is an upstream
        // capacity problem, not a bad key -- tell the user to retry rather
        // than to go and regenerate a perfectly good credential.
        const failure = /rate|limit|capacity|no endpoints|unavailable|overload/i.test(message)
          ? "unavailable"
          : "failed";
        throw new ProviderError(failure, `body error: ${message.slice(0, 300)}`);
      }

      const choice = json?.choices?.[0];
      const text = choice?.message?.content;

      if (typeof text !== "string" || text.trim() === "") {
        // Reasoning models put their working in a separate `reasoning` field
        // and only then write `content`. If the token ceiling is reached
        // during that first phase the reply comes back 200-but-empty with
        // finish_reason "length" -- the model never got to the answer. That
        // is a budget problem with an obvious remedy, not the generic
        // "something went wrong" it would otherwise be reported as.
        if (choice?.finish_reason === "length") {
          throw new ProviderError(
            "truncated",
            `hit the token ceiling before writing an answer (reasoning tokens: ${
              String(choice?.message?.reasoning ?? "").length
            } chars)`,
          );
        }
        // Otherwise: a content filter, or a shape change. Either way there is
        // nothing to show, so don't return an empty answer that looks like
        // the model had nothing to say.
        throw new ProviderError(
          "failed",
          `empty completion: ${JSON.stringify(json).slice(0, 300)}`,
        );
      }
      return text.trim();
    },
  };
}
