import { PROVIDER_MODELS } from "../types";
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
} from "./types";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

// Cost-optimized default, on the user's own key and bill. Shared with the
// setup UI via PROVIDER_MODELS so both name the same model.
const MODEL = PROVIDER_MODELS.google;

/**
 * Google's Generative Language API takes the key as a header rather than a
 * query parameter. Both are accepted, but a key in a URL ends up in request
 * logs, proxy logs, and error messages that quote the URL -- the header keeps
 * the credential out of everything that records where we sent a request.
 */
function authHeaders(apiKey: string): Record<string, string> {
  return { "x-goog-api-key": apiKey };
}

export const googleProvider: AIProvider = {
  name: "google",
  model: MODEL,

  async validateKey(apiKey: string): Promise<boolean> {
    const res = await providerFetch(
      `${BASE}/models`,
      { headers: authHeaders(apiKey) },
      VALIDATE_TIMEOUT_MS,
    );

    if (res.ok) {
      await assertModelAvailable(res, MODEL, "google");
      return true;
    }
    // Unlike the other two, Google reports a bad key as 400 with an
    // API_KEY_INVALID reason rather than 401. Treating every 400 as a bad key
    // would misreport our own malformed requests as the user's fault, so
    // match on the reason and let anything else fall through.
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      const detail = await errorDetail(res);
      if (res.status !== 400 || /API_KEY_INVALID|API key not valid/i.test(detail)) return false;
      throw new ProviderError("failed", detail);
    }
    throw new ProviderError("unavailable", await errorDetail(res));
  },

  async askQuestion(apiKey: string, systemPrompt: string, question: string): Promise<string> {
    const res = await providerFetch(
      `${BASE}/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: { ...authHeaders(apiKey), "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: question }] }],
          generationConfig: { maxOutputTokens: MAX_ANSWER_TOKENS },
        }),
      },
      ASK_TIMEOUT_MS,
    );

    if (!res.ok) {
      const detail = await errorDetail(res);
      const failure =
        res.status === 400 && /API_KEY_INVALID|API key not valid/i.test(detail)
          ? "invalid_key"
          : failureFromStatus(res.status);
      throw new ProviderError(failure, detail);
    }

    const json = await res.json();

    // A blocked prompt returns 200 with no candidates and a promptFeedback
    // block explaining why -- surfacing that as an empty answer would look
    // like the model simply said nothing.
    const blockReason = json?.promptFeedback?.blockReason;
    if (blockReason) {
      throw new ProviderError("failed", `blocked: ${blockReason}`);
    }

    const parts: unknown[] = json?.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .filter(
        (p): p is { text: string } =>
          typeof p === "object" && p !== null && typeof (p as { text?: unknown }).text === "string",
      )
      .map((p) => p.text)
      .join("")
      .trim();

    if (text === "") {
      throw new ProviderError("failed", `empty candidate: ${JSON.stringify(json).slice(0, 300)}`);
    }
    return text;
  },
};
