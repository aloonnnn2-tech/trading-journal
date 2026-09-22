import { afterEach, describe, expect, it, vi } from "vitest";
import { getProvider } from "./index";
import { ProviderError } from "./types";

// Each adapter's chatStream is driven with the provider's REAL wire format,
// chunked at awkward boundaries, to pin down three things: text reaches
// onText as it arrives, tool calls split across many deltas are assembled
// whole, and the resolved ChatResult is what chatOnce would have returned.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function sseResponse(events: string[], init: { status?: number } = {}): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const e of events) c.enqueue(enc.encode(e));
      c.close();
    },
  });
  return new Response(body, { status: init.status ?? 200, headers: { "content-type": "text/event-stream" } });
}

function stubStream(events: string[]) {
  globalThis.fetch = vi.fn(async () => sseResponse(events)) as unknown as typeof fetch;
}

const input = {
  system: "sys",
  messages: [{ role: "user" as const, content: "hi" }],
  tools: [{ name: "compute_stats", description: "d", parameters: { type: "object", properties: { group_by: { type: "string" } } } }],
};

// ---- OpenAI-compatible (used by groq, openai, mistral, ...) ---------------

describe("openai-compatible chatStream", () => {
  const provider = getProvider("groq");

  it("streams text deltas and resolves the joined text", async () => {
    stubStream([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"con', // split mid-JSON
      'tent":"lo"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const deltas: string[] = [];
    const result = await provider.chatStream!("k", input, (d) => deltas.push(d));

    expect(deltas).toEqual(["Hel", "lo"]);
    expect(result).toEqual({ kind: "text", text: "Hello" });
  });

  it("assembles a tool call whose arguments arrive in fragments", async () => {
    stubStream([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"compute_stats","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"group"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"_by\\":\\"day_of_week\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const result = await provider.chatStream!("k", input, () => {});

    expect(result.kind).toBe("tool_calls");
    if (result.kind !== "tool_calls") return;
    expect(result.calls).toEqual([{ id: "call_1", name: "compute_stats", args: { group_by: "day_of_week" } }]);
    // The assistant message echoes the calls so the next turn can pair results.
    expect(result.assistant.toolCalls).toEqual(result.calls);
  });

  it("reports truncation when the stream ends on finish_reason length", async () => {
    stubStream([
      'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    await expect(provider.chatStream!("k", input, () => {})).rejects.toMatchObject({ failure: "truncated" });
  });

  it("maps an in-stream error body to unavailable/failed like chatOnce does", async () => {
    stubStream(['data: {"error":{"message":"Rate limit reached for model"}}\n\n']);
    await expect(provider.chatStream!("k", input, () => {})).rejects.toMatchObject({ failure: "unavailable" });
  });

  it("maps a non-2xx status before reading the body", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('{"error":{"message":"bad key"}}', { status: 401 }),
    ) as unknown as typeof fetch;
    await expect(provider.chatStream!("k", input, () => {})).rejects.toMatchObject({ failure: "invalid_key" });
  });
});

// ---- Anthropic -----------------------------------------------------------

describe("anthropic chatStream", () => {
  const provider = getProvider("anthropic");

  it("streams text_delta and stops on message_stop", async () => {
    stubStream([
      'event: message_start\ndata: {"type":"message_start"}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi "}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"there"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]);
    const deltas: string[] = [];
    const result = await provider.chatStream!("k", input, (d) => deltas.push(d));

    expect(deltas).toEqual(["Hi ", "there"]);
    expect(result).toEqual({ kind: "text", text: "Hi there" });
  });

  it("assembles a tool_use block from input_json_delta fragments", async () => {
    stubStream([
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"compute_stats"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"group_by\\":"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"month\\"}"}}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ]);
    const result = await provider.chatStream!("k", input, () => {});

    expect(result.kind).toBe("tool_calls");
    if (result.kind !== "tool_calls") return;
    expect(result.calls).toEqual([{ id: "toolu_1", name: "compute_stats", args: { group_by: "month" } }]);
  });

  it("reports max_tokens as truncated even with partial text", async () => {
    stubStream([
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"cut off"}}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ]);
    await expect(provider.chatStream!("k", input, () => {})).rejects.toMatchObject({ failure: "truncated" });
  });
});

// ---- Google --------------------------------------------------------------

describe("google chatStream", () => {
  const provider = getProvider("google");

  it("streams text parts across chunks", async () => {
    stubStream([
      'data: {"candidates":[{"content":{"parts":[{"text":"Win rate "}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"is 40%"}]},"finishReason":"STOP"}]}\n\n',
    ]);
    const deltas: string[] = [];
    const result = await provider.chatStream!("k", input, (d) => deltas.push(d));

    expect(deltas).toEqual(["Win rate ", "is 40%"]);
    expect(result).toEqual({ kind: "text", text: "Win rate is 40%" });
  });

  it("collects functionCall parts and synthesises ids unique across rounds", async () => {
    // Gemini issues no call ids. The id pairs the stored tool row to its call
    // and is unique per conversation in the database, so `name-0` -- which
    // the first version used -- collided with the previous round's call.
    const event =
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"compute_stats","args":{"group_by":"ticker"}}}]}}]}\n\n';
    stubStream([event]);
    const first = await provider.chatStream!("k", input, () => {});
    stubStream([event]);
    const second = await provider.chatStream!("k", input, () => {});

    expect(first.kind).toBe("tool_calls");
    if (first.kind !== "tool_calls" || second.kind !== "tool_calls") return;
    expect(first.calls[0]).toMatchObject({ name: "compute_stats", args: { group_by: "ticker" } });
    expect(first.calls[0].id).toMatch(/^compute_stats-[a-z0-9]{8}$/);
    expect(second.calls[0].id).not.toBe(first.calls[0].id);
  });

  it("reports MAX_TOKENS as truncated", async () => {
    stubStream(['data: {"candidates":[{"content":{"parts":[{"text":"x"}]},"finishReason":"MAX_TOKENS"}]}\n\n']);
    await expect(provider.chatStream!("k", input, () => {})).rejects.toMatchObject({ failure: "truncated" });
  });
});

// ---- Shared behaviour ----------------------------------------------------

describe("chatStream abort", () => {
  it("rejects with unavailable when the caller aborts mid-stream", async () => {
    const provider = getProvider("groq");
    const controller = new AbortController();
    const enc = new TextEncoder();
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      // Honour the signal the adapter passes, like real fetch would.
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"a"}}]}\n\n'));
          init?.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
        },
      });
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;

    const p = provider.chatStream!("k", input, () => controller.abort(), controller.signal);
    await expect(p).rejects.toBeInstanceOf(ProviderError);
    await expect(p).rejects.toMatchObject({ failure: "unavailable" });
  });
});
