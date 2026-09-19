import {
  ProviderError,
  type AIProvider,
  type ChatMessage,
  type ChatTurn,
  type ToolCall,
  type ToolDef,
} from "./types";

// Runs the tool-calling loop that turns Ask from a one-shot text dump into an
// agent that fetches and computes exact numbers. Provider-agnostic: it only
// speaks the neutral ChatMessage/ToolCall vocabulary and leans on the
// provider's own `chatOnce` to translate each round-trip.
//
// Two things bound it, both about the serverless request ceiling: a hard
// iteration cap, and a wall-clock deadline. On the last allowed turn -- or as
// soon as there is no longer time for another round-trip to consume a tool's
// result -- tools are withheld so the model is forced to answer with what it
// has, rather than requesting a call that can never be serviced.

export interface ToolConversationResult {
  answer: string;
  /** Tool names in call order, so the UI can show "checked your trades". */
  steps: string[];
}

export interface RunToolConversationInput {
  apiKey: string;
  system: string;
  question: string;
  history?: ChatTurn[];
  tools: ToolDef[];
  execute: (call: ToolCall) => Promise<string>;
  maxTokens?: number;
  maxIterations: number;
  /** Absolute time (Date.now ms) the whole exchange must finish by. */
  deadline: number;
  /** Ceiling for any single model round-trip. */
  perCallTimeoutMs: number;
}

/**
 * Appended whenever tools are withheld to force a written answer.
 *
 * Removing the tools silently is not enough. A model mid-tool-sequence will
 * often try to call one anyway, and an OpenAI-compatible provider then
 * rejects the WHOLE request rather than answering -- Groq returns
 * `400 tool_use_failed: "Tool choice is none, but model called a tool"`.
 * That killed the tool path on exactly the questions that needed the most
 * tool calls, and the full-journal fallback that followed then burned what
 * was left of a free tier's per-minute tokens and failed too.
 *
 * Saying it in words costs a few tokens and makes the turn do what
 * withholding the tools was only implying.
 */
const ANSWER_NOW_INSTRUCTION =
  "Now write the final answer for the user, using the tool results already provided above. " +
  "Do not request any more tools -- none are available on this turn.";

export async function runToolConversation(
  provider: AIProvider,
  input: RunToolConversationInput,
): Promise<ToolConversationResult> {
  if (!provider.chatOnce) {
    throw new ProviderError("failed", "provider has no tool support");
  }

  const messages: ChatMessage[] = [
    ...(input.history ?? []).map((h): ChatMessage => ({ role: h.role, content: h.content })),
    { role: "user", content: input.question },
  ];
  const steps: string[] = [];

  for (let i = 0; i < input.maxIterations; i++) {
    const remaining = input.deadline - Date.now();
    const timeoutMs = Math.max(3000, Math.min(input.perCallTimeoutMs, remaining));
    // Withhold tools on the final iteration, or when there isn't time left to
    // service another call, so the model must produce text this turn.
    const offerTools = i < input.maxIterations - 1 && remaining > input.perCallTimeoutMs;

    const result = await provider.chatOnce(input.apiKey, {
      system: input.system,
      // The instruction rides along only on a turn where tools are withheld,
      // and is never added to `messages`, so it cannot accumulate across
      // iterations or leak into the next request.
      messages: offerTools
        ? messages
        : [...messages, { role: "user", content: ANSWER_NOW_INSTRUCTION }],
      tools: offerTools ? input.tools : [],
      maxTokens: input.maxTokens,
      timeoutMs,
    });

    if (result.kind === "text") return { answer: result.text, steps };

    messages.push(result.assistant);
    for (const call of result.calls) {
      steps.push(call.name);
      const output = await input.execute(call);
      messages.push({ role: "tool", content: output, toolCallId: call.id, toolName: call.name });
    }
  }

  // Exhausted the iteration budget still wanting tools: one last no-tools call.
  const final = await provider.chatOnce(input.apiKey, {
    system: input.system,
    messages: [...messages, { role: "user", content: ANSWER_NOW_INSTRUCTION }],
    tools: [],
    maxTokens: input.maxTokens,
    timeoutMs: Math.max(3000, input.deadline - Date.now()),
  });
  if (final.kind === "text") return { answer: final.text, steps };
  throw new ProviderError("failed", "the model kept requesting tools without answering");
}
