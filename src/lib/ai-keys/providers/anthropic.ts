import { PROVIDER_MODELS } from "../types";
import { assertModelAvailable } from "./model-check";
import { sseData } from "./sse";
import {
  ASK_TIMEOUT_MS,
  ProviderError,
  VALIDATE_TIMEOUT_MS,
  errorDetail,
  failureFromStatus,
  providerFetch,
  retryAfterSeconds,
  type AIProvider,
  type AskOptions,
  type ChatMessage,
  type ChatOnceInput,
  type ChatResult,
  type ToolCall,
} from "./types";

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

/** Neutral messages -> Anthropic messages. Tool results are not their own
 *  role here: they are `tool_result` blocks inside a user turn, and several
 *  in a row collapse into one user turn. */
function toAnthropicMessages(messages: ChatMessage[]): unknown[] {
  const out: unknown[] = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i];
    if (m.role === "tool") {
      const blocks: unknown[] = [];
      while (i < messages.length && messages[i].role === "tool") {
        blocks.push({ type: "tool_result", tool_use_id: messages[i].toolCallId, content: messages[i].content });
        i++;
      }
      out.push({ role: "user", content: blocks });
      continue;
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      const content: unknown[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const c of m.toolCalls) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.args });
      out.push({ role: "assistant", content });
    } else {
      out.push({ role: m.role, content: m.content });
    }
    i++;
  }
  return out;
}

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

// Extra room added on top of a caller-requested answer budget, for the same
// reason MAX_TOKENS is generous: here `max_tokens` bounds thinking PLUS the
// visible reply. A caller asking for "2000 tokens of answer" means 2000
// tokens it can render, so passing that number straight through would spend
// most of it thinking and truncate the reply -- the exact failure the comment
// above warns about. Callers size their request against the visible output;
// this is the provider-specific cost of getting there.
const THINKING_HEADROOM = 2000;

/** The request body shared by chatOnce and chatStream, so the two never drift. */
function chatBody(input: ChatOnceInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: MODEL,
    max_tokens: (input.maxTokens ?? MAX_TOKENS) + THINKING_HEADROOM,
    output_config: { effort: "low" },
    // Thinking is OFF on the chat path, deliberately. With it on, a tool-use
    // turn comes back with thinking blocks that must be echoed verbatim when
    // the tool results are sent, or the API rejects the request -- and the
    // neutral transcript stored in ai_messages carries text and calls only.
    // Storing opaque signed blocks per provider is not worth the small
    // quality gain on lookups; `effort: low` already keeps spend down.
    thinking: { type: "disabled" },
    system: input.system,
    messages: toAnthropicMessages(input.messages),
  };
  if (input.tools.length > 0) {
    body.tools = input.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
    body.tool_choice = { type: "auto" };
  }
  return body;
}

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

  async askQuestion(
    apiKey: string,
    systemPrompt: string,
    question: string,
    options?: AskOptions,
  ): Promise<string> {
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
          max_tokens:
            options?.maxTokens === undefined
              ? MAX_TOKENS
              : options.maxTokens + THINKING_HEADROOM,
          // Low effort keeps the token spend down on what is, by this point,
          // a question against a pre-summarized context rather than an
          // open-ended reasoning task.
          output_config: { effort: "low" },
          // `system` is a top-level parameter here, not a message role.
          system: systemPrompt,
          messages: [{ role: "user", content: question }],
        }),
      },
      options?.timeoutMs ?? ASK_TIMEOUT_MS,
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

    // max_tokens bounds thinking AND reply here, so a budget failure looks
    // like an empty (or cut-off) message. Without this it was reported as the
    // generic "try a different key", pointing at a key that is fine.
    if (json?.stop_reason === "max_tokens") {
      throw new ProviderError(
        "truncated",
        `stopped at the token ceiling after ${text.length} chars`,
      );
    }
    if (text === "") {
      throw new ProviderError("failed", `empty message: ${JSON.stringify(json).slice(0, 300)}`);
    }
    return text;
  },

  async chatOnce(apiKey: string, input: ChatOnceInput): Promise<ChatResult> {
    const body = chatBody(input);

    const res = await providerFetch(
      `${BASE}/messages`,
      {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": API_VERSION, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      input.timeoutMs ?? ASK_TIMEOUT_MS,
    );

    if (!res.ok) {
      throw new ProviderError(failureFromStatus(res.status), await errorDetail(res));
    }

    const json = await res.json();
    if (json?.stop_reason === "refusal") {
      throw new ProviderError("failed", `refusal: ${JSON.stringify(json?.stop_details ?? null).slice(0, 200)}`);
    }

    const blocks: AnthropicBlock[] = Array.isArray(json?.content) ? json.content : [];
    const toolUses = blocks.filter((b) => b.type === "tool_use" && typeof b.name === "string");
    const textOut = blocks
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("")
      .trim();

    if (toolUses.length > 0) {
      const calls: ToolCall[] = toolUses.map((b) => ({
        id: b.id ?? (b.name as string),
        name: b.name as string,
        args: b.input && typeof b.input === "object" ? (b.input as Record<string, unknown>) : {},
      }));
      return {
        kind: "tool_calls",
        calls,
        assistant: { role: "assistant", content: textOut, toolCalls: calls },
      };
    }

    if (textOut === "") {
      throw new ProviderError("failed", `empty message: ${JSON.stringify(json).slice(0, 300)}`);
    }
    return { kind: "text", text: textOut };
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
      res = await fetch(`${BASE}/messages`, {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": API_VERSION, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        redirect: "error", // see providerFetch
        signal: combined,
      });
    } catch (err) {
      const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      throw new ProviderError("unavailable", `network: ${reason}`);
    }

    if (!res.ok) {
      throw new ProviderError(failureFromStatus(res.status), await errorDetail(res), retryAfterSeconds(res));
    }

    // Anthropic streams content blocks by index. Text blocks arrive as
    // text_delta; tool_use blocks arrive as a start (id + name) followed by
    // input_json_delta fragments that are concatenated and parsed at the end.
    let text = "";
    let stopReason: string | null = null;
    const blocks = new Map<number, { kind: "text" | "tool_use"; id?: string; name?: string; json: string }>();

    try {
      for await (const { event, data } of sseData(res, combined)) {
        let json: unknown;
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        const j = json as {
          type?: string;
          index?: number;
          content_block?: { type?: string; id?: string; name?: string };
          delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
          error?: { type?: string; message?: string };
        };
        const type = j.type ?? event;

        if (type === "error") {
          const message = j.error?.message ?? "stream error";
          const failure = /rate|limit|overloaded|capacity/i.test(message) ? "unavailable" : "failed";
          throw new ProviderError(failure, `stream error: ${message.slice(0, 300)}`);
        }
        if (type === "content_block_start" && typeof j.index === "number") {
          const cb = j.content_block;
          blocks.set(j.index, {
            kind: cb?.type === "tool_use" ? "tool_use" : "text",
            id: cb?.id,
            name: cb?.name,
            json: "",
          });
        } else if (type === "content_block_delta" && typeof j.index === "number") {
          const d = j.delta;
          if (d?.type === "text_delta" && typeof d.text === "string") {
            text += d.text;
            onText(d.text);
          } else if (d?.type === "input_json_delta" && typeof d.partial_json === "string") {
            const b = blocks.get(j.index);
            if (b) b.json += d.partial_json;
          }
        } else if (type === "message_delta") {
          if (j.delta?.stop_reason) stopReason = j.delta.stop_reason;
        } else if (type === "message_stop") {
          break;
        }
      }
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      throw new ProviderError("unavailable", `stream: ${reason}`);
    }

    if (stopReason === "refusal") {
      throw new ProviderError("failed", "refusal");
    }

    const toolBlocks = [...blocks.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, b]) => b)
      .filter((b) => b.kind === "tool_use" && b.name);
    if (toolBlocks.length > 0) {
      const calls: ToolCall[] = toolBlocks.map((b) => {
        let args: Record<string, unknown> = {};
        try {
          const parsed = b.json.trim() ? JSON.parse(b.json) : {};
          if (parsed && typeof parsed === "object") args = parsed as Record<string, unknown>;
        } catch {
          // Unparseable arguments: surface the call with empty args so the
          // executor's own validation reports the problem to the model.
        }
        return { id: b.id ?? b.name!, name: b.name!, args };
      });
      return {
        kind: "tool_calls",
        calls,
        assistant: { role: "assistant", content: text.trim(), toolCalls: calls },
      };
    }

    const out = text.trim();
    if (stopReason === "max_tokens") {
      throw new ProviderError("truncated", `stopped at the token ceiling after ${out.length} chars`);
    }
    if (out === "") {
      throw new ProviderError("failed", "empty streamed message");
    }
    return { kind: "text", text: out };
  },
};
