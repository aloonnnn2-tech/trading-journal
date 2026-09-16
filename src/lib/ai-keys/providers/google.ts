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
  type AskOptions,
  type ChatMessage,
  type ChatOnceInput,
  type ChatResult,
  type ToolCall,
} from "./types";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
}

/** Neutral messages -> Gemini `contents`. The assistant role is "model"; a
 *  tool result is a `functionResponse` part paired by NAME (Gemini has no
 *  call ids), which is why the neutral tool message carries `toolName`. */
function toGeminiContents(messages: ChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      let response: unknown;
      try {
        response = JSON.parse(m.content);
      } catch {
        response = { result: m.content };
      }
      if (response === null || typeof response !== "object" || Array.isArray(response)) {
        response = { result: response };
      }
      return { role: "user", parts: [{ functionResponse: { name: m.toolName ?? "tool", response } }] };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      const parts: unknown[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const c of m.toolCalls) parts.push({ functionCall: { name: c.name, args: c.args } });
      return { role: "model", parts };
    }
    return { role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] };
  });
}

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

  async askQuestion(
    apiKey: string,
    systemPrompt: string,
    question: string,
    options?: AskOptions,
  ): Promise<string> {
    const res = await providerFetch(
      `${BASE}/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: { ...authHeaders(apiKey), "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          // Gemini calls the assistant role "model" and wraps text in parts[],
          // so ChatTurn needs translating rather than spreading.
          contents: [
            ...(options?.history ?? []).map((turn) => ({
              role: turn.role === "assistant" ? "model" : "user",
              parts: [{ text: turn.content }],
            })),
            { role: "user", parts: [{ text: question }] },
          ],
          generationConfig: { maxOutputTokens: options?.maxTokens ?? MAX_ANSWER_TOKENS },
        }),
      },
      options?.timeoutMs ?? ASK_TIMEOUT_MS,
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

  async chatOnce(apiKey: string, input: ChatOnceInput): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      system_instruction: { parts: [{ text: input.system }] },
      contents: toGeminiContents(input.messages),
      generationConfig: { maxOutputTokens: input.maxTokens ?? MAX_ANSWER_TOKENS },
    };
    if (input.tools.length > 0) {
      body.tools = [
        {
          function_declarations: input.tools.map((t) => {
            const props = (t.parameters as { properties?: Record<string, unknown> }).properties ?? {};
            // Gemini rejects an object schema with no properties, so a
            // no-argument tool declares no parameters at all.
            return Object.keys(props).length > 0
              ? { name: t.name, description: t.description, parameters: t.parameters }
              : { name: t.name, description: t.description };
          }),
        },
      ];
    }

    const res = await providerFetch(
      `${BASE}/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: { ...authHeaders(apiKey), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      input.timeoutMs ?? ASK_TIMEOUT_MS,
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
    const blockReason = json?.promptFeedback?.blockReason;
    if (blockReason) throw new ProviderError("failed", `blocked: ${blockReason}`);

    const parts: GeminiPart[] = json?.candidates?.[0]?.content?.parts ?? [];
    const fcs = parts.filter((p) => p && typeof p === "object" && p.functionCall?.name);
    const textOut = parts
      .filter((p) => typeof p.text === "string")
      .map((p) => p.text as string)
      .join("")
      .trim();

    if (fcs.length > 0) {
      const calls: ToolCall[] = fcs.map((p, i) => ({
        id: `${p.functionCall!.name}-${i}`,
        name: p.functionCall!.name,
        args:
          p.functionCall!.args && typeof p.functionCall!.args === "object"
            ? p.functionCall!.args
            : {},
      }));
      return {
        kind: "tool_calls",
        calls,
        assistant: { role: "assistant", content: textOut, toolCalls: calls },
      };
    }

    if (textOut === "") {
      throw new ProviderError("failed", `empty candidate: ${JSON.stringify(json).slice(0, 300)}`);
    }
    return { kind: "text", text: textOut };
  },
};
