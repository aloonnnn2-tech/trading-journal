import type { AIProviderName } from "../types";
import { assertModelAvailable } from "./model-check";
import { sseData } from "./sse";
import {
  ASK_TIMEOUT_MS,
  MAX_ANSWER_TOKENS,
  ProviderError,
  VALIDATE_TIMEOUT_MS,
  errorDetail,
  failureFromStatus,
  retryAfterFromMessage,
  retryAfterSeconds,
  providerFetch,
  syntheticToolCallId,
  type AIProvider,
  type AskOptions,
  type ChatMessage,
  type ChatOnceInput,
  type ChatResult,
  type ToolCall,
} from "./types";

/** Neutral messages -> OpenAI `messages`. Assistant tool-call turns and tool
 *  results carry the extra fields OpenAI needs to pair a call to its answer. */
function toOpenAIMessages(system: string, messages: ChatMessage[]): unknown[] {
  const out: unknown[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "tool") {
      out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      out.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.args) },
        })),
      });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

/** Tolerant JSON parse for tool arguments -- a model that emits invalid JSON
 *  should get an empty-args tool run (which the executor validates and can
 *  reject) rather than crash the whole request. */
function parseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

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
  /**
   * Where the zero-token liveness check lists models. Defaults to
   * `${baseUrl}/models`, which is where every OpenAI-shaped provider puts it.
   * GitHub Models is the exception: its model catalog lives on a different
   * host and path, so it passes this explicitly. `assertModelAvailable` reads
   * the shape per provider name, so a non-standard body is handled there.
   */
  modelsUrl?: string;
}

export function createOpenAICompatibleProvider(config: OpenAICompatibleConfig): AIProvider {
  const { name, baseUrl, model, headers = {} } = config;
  const modelsUrl = config.modelsUrl ?? `${baseUrl}/models`;

  function auth(apiKey: string): Record<string, string> {
    return { Authorization: `Bearer ${apiKey}`, ...headers };
  }

  /** The request body shared by chatOnce and chatStream, so the two never drift. */
  function chatBody(input: ChatOnceInput): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model,
      max_tokens: input.maxTokens ?? MAX_ANSWER_TOKENS,
      messages: toOpenAIMessages(input.system, input.messages),
    };
    // Only send tools when there are some: several gateways reject an empty
    // `tools: []`, and an empty array is also how runTurn signals "answer
    // now, no more calls" at the round ceiling.
    if (input.tools.length > 0) {
      body.tools = input.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = "auto";
    }
    return body;
  }

  return {
    name,
    model,

    async validateKey(apiKey: string): Promise<boolean> {
      // Listing models costs no tokens, which matters because this runs on
      // every save attempt including the mistyped ones.
      const res = await providerFetch(
        modelsUrl,
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
            messages: [
              { role: "system", content: systemPrompt },
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
          retryAfterSeconds(res),
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

      // Non-empty AND cut off. This used to fall straight through to the
      // return below, so an answer that stopped mid-sentence was handed back
      // as if it were finished -- invisible on Ask, and worse on the review
      // routes, where the partial JSON fails to parse and the user is told the
      // model "replied with something this app couldn't read", sending them to
      // change a provider that was never the problem.
      if (choice?.finish_reason === "length") {
        throw new ProviderError(
          "truncated",
          `stopped at the token ceiling after ${text.length} chars`,
        );
      }

      return text.trim();
    },

    async chatOnce(apiKey: string, input: ChatOnceInput): Promise<ChatResult> {
      const body = chatBody(input);

      const res = await providerFetch(
        `${baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: { ...auth(apiKey), "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        input.timeoutMs ?? ASK_TIMEOUT_MS,
      );

      if (!res.ok) {
        const detail = await errorDetail(res);
        const missing =
          /model_not_found|does not exist|no such model|unknown model|model.*not found/i.test(detail);
        throw new ProviderError(
          missing ? "model_missing" : failureFromStatus(res.status),
          detail,
          retryAfterSeconds(res),
        );
      }

      const json = await res.json();
      if (json?.error) {
        const message = String(json.error?.message ?? json.error);
        const failure = /rate|limit|capacity|no endpoints|unavailable|overload/i.test(message)
          ? "unavailable"
          : "failed";
        throw new ProviderError(failure, `body error: ${message.slice(0, 300)}`, retryAfterFromMessage(message));
      }

      const choice = json?.choices?.[0];
      const rawCalls = choice?.message?.tool_calls;
      if (Array.isArray(rawCalls) && rawCalls.length > 0) {
        const calls: ToolCall[] = rawCalls
          .filter((c: unknown) => (c as { function?: { name?: string } })?.function?.name)
          .map((c: { id?: string; function: { name: string; arguments?: string } }) => ({
            id: c.id ?? syntheticToolCallId(c.function.name),
            name: c.function.name,
            args: parseArgs(c.function.arguments),
          }));
        return {
          kind: "tool_calls",
          calls,
          assistant: { role: "assistant", content: choice.message.content ?? "", toolCalls: calls },
        };
      }

      const text = choice?.message?.content;
      if (typeof text !== "string" || text.trim() === "") {
        if (choice?.finish_reason === "length") {
          throw new ProviderError("truncated", "hit the token ceiling before writing an answer");
        }
        throw new ProviderError("failed", `empty completion: ${JSON.stringify(json).slice(0, 300)}`);
      }
      if (choice?.finish_reason === "length") {
        throw new ProviderError(
          "truncated",
          `stopped at the token ceiling after ${text.length} chars`,
        );
      }
      return { kind: "text", text: text.trim() };
    },

    async chatStream(
      apiKey: string,
      input: ChatOnceInput,
      onText: (delta: string) => void,
      signal?: AbortSignal,
    ): Promise<ChatResult> {
      const body = { ...chatBody(input), stream: true };

      const timeout = AbortSignal.timeout(input.timeoutMs ?? ASK_TIMEOUT_MS);
      const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;

      let res: Response;
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { ...auth(apiKey), "Content-Type": "application/json" },
          body: JSON.stringify(body),
          redirect: "error", // see providerFetch
        signal: combined,
        });
      } catch (err) {
        const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        throw new ProviderError("unavailable", `network: ${reason}`);
      }

      // Status arrives before the body, so non-2xx is handled exactly as in
      // chatOnce -- the error body is small and not streamed.
      if (!res.ok) {
        const detail = await errorDetail(res);
        const missing =
          /model_not_found|does not exist|no such model|unknown model|model.*not found/i.test(detail);
        throw new ProviderError(
          missing ? "model_missing" : failureFromStatus(res.status),
          detail,
          retryAfterSeconds(res),
        );
      }

      // Accumulators. Tool calls arrive as fragments keyed by `index`, with the
      // arguments JSON split across many deltas; they are assembled here and
      // only surfaced whole. A gateway that omits `index` gets one slot per
      // distinct `id`, and a fragment with neither continues the last call.
      let text = "";
      let finishReason: string | null = null;
      const calls = new Map<number, { id?: string; name?: string; args: string }>();
      const slotById = new Map<string, number>();
      let lastSlot = -1;

      try {
        for await (const { data } of sseData(res, combined)) {
          if (data === "[DONE]") break;
          let json: unknown;
          try {
            json = JSON.parse(data);
          } catch {
            continue; // keep-alive or a malformed line; nothing to act on
          }
          const j = json as {
            error?: { message?: string } | string;
            choices?: {
              delta?: {
                content?: string | null;
                tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
              };
              finish_reason?: string | null;
            }[];
          };

          // Some gateways send an error as an event body with a 200 status.
          if (j.error) {
            const message = String((j.error as { message?: string })?.message ?? j.error);
            const failure = /rate|limit|capacity|no endpoints|unavailable|overload/i.test(message)
              ? "unavailable"
              : "failed";
            throw new ProviderError(failure, `stream error: ${message.slice(0, 300)}`, retryAfterFromMessage(message));
          }

          const choice = j.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta;
          if (typeof delta?.content === "string" && delta.content.length > 0) {
            text += delta.content;
            onText(delta.content);
          }
          for (const frag of delta?.tool_calls ?? []) {
            let idx: number;
            if (typeof frag.index === "number") {
              idx = frag.index;
            } else if (frag.id) {
              idx = slotById.get(frag.id) ?? calls.size;
              slotById.set(frag.id, idx);
            } else {
              idx = Math.max(lastSlot, 0);
            }
            lastSlot = idx;
            const acc = calls.get(idx) ?? { args: "" };
            if (frag.id) acc.id = frag.id;
            if (frag.function?.name) acc.name = frag.function.name;
            if (frag.function?.arguments) acc.args += frag.function.arguments;
            calls.set(idx, acc);
          }
          if (choice.finish_reason) finishReason = choice.finish_reason;
        }
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        throw new ProviderError("unavailable", `stream: ${reason}`);
      }

      if (calls.size > 0) {
        const assembled: ToolCall[] = [...calls.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, c]) => c)
          .filter((c) => c.name)
          .map((c) => ({ id: c.id ?? syntheticToolCallId(c.name!), name: c.name!, args: parseArgs(c.args) }));
        return {
          kind: "tool_calls",
          calls: assembled,
          assistant: { role: "assistant", content: text, toolCalls: assembled },
        };
      }

      if (text.trim() === "") {
        if (finishReason === "length") {
          throw new ProviderError("truncated", "hit the token ceiling before writing an answer");
        }
        throw new ProviderError("failed", "empty streamed completion");
      }
      if (finishReason === "length") {
        throw new ProviderError("truncated", `stopped at the token ceiling after ${text.length} chars`);
      }
      return { kind: "text", text: text.trim() };
    },
  };
}

