import { afterEach, describe, expect, it, vi } from "vitest";
import { getProvider } from "./index";
import type { ChatOnceInput } from "./types";

// A tool result's chart reaches each provider in the shape that provider's
// API accepts. Checked on the request body each adapter actually sends.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function capture(reply: unknown): { body: () => Record<string, unknown> } {
  let sent: string | undefined;
  globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    sent = init?.body as string;
    return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { body: () => JSON.parse(sent ?? "{}") };
}

const call = { id: "v1", name: "view_trade_chart", args: { image_id: "img-1" } };
const input: ChatOnceInput = {
  system: "sys",
  tools: [],
  messages: [
    { role: "user", content: "was my entry good?" },
    { role: "assistant", content: "", toolCalls: [call] },
    {
      role: "tool",
      content: '{"ok":true}',
      toolCallId: "v1",
      toolName: "view_trade_chart",
      images: [{ mime: "image/jpeg", base64: "QUJD" }],
    },
  ],
};

describe("tool-result images on the wire", () => {
  it("Anthropic: the image sits inside the tool_result that fetched it", async () => {
    const wire = capture({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" });
    await getProvider("anthropic").chatOnce!("k", input);
    const messages = wire.body().messages as { role: string; content: unknown }[];
    expect(messages.at(-1)).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "v1",
          content: [
            { type: "text", text: '{"ok":true}' },
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } },
          ],
        },
      ],
    });
  });

  it("OpenAI-compatible: a user message with the image follows the tool results", async () => {
    const wire = capture({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] });
    await getProvider("openai").chatOnce!("k", input);
    const messages = wire.body().messages as { role: string; content: unknown }[];
    expect(messages.at(-2)).toEqual({ role: "tool", tool_call_id: "v1", content: '{"ok":true}' });
    expect(messages.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text" }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } }],
    });
  });

  it("Gemini: the image follows the function response as inline data", async () => {
    const wire = capture({ candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }] });
    await getProvider("google").chatOnce!("k", input);
    const contents = wire.body().contents as { role: string; parts: unknown[] }[];
    expect(contents.at(-2)?.parts[0]).toHaveProperty("functionResponse");
    expect(contents.at(-1)).toMatchObject({
      role: "user",
      parts: [{ text: expect.any(String) }, { inlineData: { mimeType: "image/jpeg", data: "QUJD" } }],
    });
  });

  it("sends no image when a tool result has none", async () => {
    const wire = capture({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] });
    const plain = { ...input, messages: input.messages.map((m) => ({ ...m, images: undefined })) };
    await getProvider("openai").chatOnce!("k", plain);
    expect(JSON.stringify(wire.body())).not.toContain("image_url");
  });
});
