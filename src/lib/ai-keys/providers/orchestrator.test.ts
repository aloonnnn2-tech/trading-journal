import { describe, it, expect } from "vitest";
import { runToolConversation } from "./orchestrator";
import {
  ProviderError,
  type AIProvider,
  type ChatOnceInput,
  type ChatResult,
  type ToolDef,
} from "./types";

// The orchestrator is provider-agnostic: it only speaks the neutral
// ChatMessage/ToolCall vocabulary and drives whatever `chatOnce` it is given.
// So a scripted mock `chatOnce` is enough to prove the loop's behaviour without
// any real provider or model -- which is the only part of the agentic path that
// can be verified without a live per-user API key.

const TOOLS: ToolDef[] = [
  { name: "compute_stats", description: "d", parameters: { type: "object", properties: {} } },
];

function textResult(text: string): ChatResult {
  return { kind: "text", text };
}

function toolCallResult(name: string, args: Record<string, unknown> = {}): ChatResult {
  const call = { id: `${name}-1`, name, args };
  return { kind: "tool_calls", calls: [call], assistant: { role: "assistant", content: "", toolCalls: [call] } };
}

// A provider whose chatOnce simply replays a script, recording every input it
// was handed so the test can assert what the loop sent (tools offered, and the
// tool results fed back in).
function scriptedProvider(script: ChatResult[]) {
  const seen: ChatOnceInput[] = [];
  let i = 0;
  const provider: AIProvider = {
    name: "openai",
    model: "test-model",
    validateKey: async () => true,
    askQuestion: async () => "unused",
    chatOnce: async (_apiKey: string, input: ChatOnceInput) => {
      seen.push(input);
      const next = script[i++];
      if (!next) throw new Error("mock script exhausted");
      return next;
    },
  };
  return { provider, seen };
}

const FAR = () => Date.now() + 60_000;

describe("runToolConversation", () => {
  it("executes a requested tool, feeds the result back, and returns the final text", async () => {
    const { provider, seen } = scriptedProvider([
      toolCallResult("compute_stats", { group_by: "day_of_week" }),
      textResult("Your Tuesdays are your best day."),
    ]);
    const executed: string[] = [];

    const result = await runToolConversation(provider, {
      apiKey: "k",
      system: "sys",
      question: "which day is best?",
      tools: TOOLS,
      execute: async (call) => {
        executed.push(call.name);
        return JSON.stringify({ best: "Tuesday" });
      },
      maxIterations: 3,
      deadline: FAR(),
      perCallTimeoutMs: 5_000,
    });

    expect(result.answer).toBe("Your Tuesdays are your best day.");
    expect(result.steps).toEqual(["compute_stats"]); // surfaced to the UI
    expect(executed).toEqual(["compute_stats"]);

    // The second round-trip must carry the assistant tool-call turn AND the
    // tool result, or the model would answer without ever seeing the data.
    const secondCall = seen[1];
    const toolMsg = secondCall.messages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toBe(JSON.stringify({ best: "Tuesday" }));
    expect(toolMsg?.toolName).toBe("compute_stats");
    expect(secondCall.messages.some((m) => m.role === "assistant" && m.toolCalls?.length)).toBe(true);
  });

  it("answers immediately when the first turn is already text", async () => {
    const { provider } = scriptedProvider([textResult("No tools needed.")]);
    const result = await runToolConversation(provider, {
      apiKey: "k",
      system: "sys",
      question: "hi",
      tools: TOOLS,
      execute: async () => "unused",
      maxIterations: 3,
      deadline: FAR(),
      perCallTimeoutMs: 5_000,
    });
    expect(result.answer).toBe("No tools needed.");
    expect(result.steps).toEqual([]);
  });

  it("withholds tools on the final loop turn so the model must answer", async () => {
    // Two iterations: turn 0 may use tools, turn 1 (the last) must not.
    const { provider, seen } = scriptedProvider([
      toolCallResult("compute_stats"),
      textResult("done"),
    ]);
    await runToolConversation(provider, {
      apiKey: "k",
      system: "sys",
      question: "q",
      tools: TOOLS,
      execute: async () => "{}",
      maxIterations: 2,
      deadline: FAR(),
      perCallTimeoutMs: 5_000,
    });
    expect(seen[0].tools).toHaveLength(1); // offered on the first turn
    expect(seen[1].tools).toHaveLength(0); // withheld on the last turn
  });

  it("stops at the iteration cap and then throws if the model never answers", async () => {
    // Always asks for a tool, never produces text.
    const { provider } = scriptedProvider([
      toolCallResult("compute_stats"),
      toolCallResult("compute_stats"),
      toolCallResult("compute_stats"),
      toolCallResult("compute_stats"),
    ]);
    const executed: string[] = [];
    await expect(
      runToolConversation(provider, {
        apiKey: "k",
        system: "sys",
        question: "q",
        tools: TOOLS,
        execute: async (call) => {
          executed.push(call.name);
          return "{}";
        },
        maxIterations: 2,
        deadline: FAR(),
        perCallTimeoutMs: 5_000,
      }),
    ).rejects.toBeInstanceOf(ProviderError);
    // The cap is real: exactly maxIterations tool round-trips were executed,
    // not an unbounded loop.
    expect(executed).toHaveLength(2);
  });

  it("propagates a chatOnce error so the route can fall back to the text path", async () => {
    const provider: AIProvider = {
      name: "openai",
      model: "test-model",
      validateKey: async () => true,
      askQuestion: async () => "unused",
      chatOnce: async () => {
        throw new ProviderError("unavailable", "boom");
      },
    };
    await expect(
      runToolConversation(provider, {
        apiKey: "k",
        system: "sys",
        question: "q",
        tools: TOOLS,
        execute: async () => "{}",
        maxIterations: 3,
        deadline: FAR(),
        perCallTimeoutMs: 5_000,
      }),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it("refuses a provider that has no tool support", async () => {
    const provider: AIProvider = {
      name: "openai",
      model: "test-model",
      validateKey: async () => true,
      askQuestion: async () => "unused",
      // no chatOnce
    };
    await expect(
      runToolConversation(provider, {
        apiKey: "k",
        system: "sys",
        question: "q",
        tools: TOOLS,
        execute: async () => "{}",
        maxIterations: 3,
        deadline: FAR(),
        perCallTimeoutMs: 5_000,
      }),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});
