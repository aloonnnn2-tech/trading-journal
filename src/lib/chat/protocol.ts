import type { ProviderFailure, ToolCall } from "@/lib/ai-keys/providers/types";

/**
 * The wire format between the browser and `POST /api/chat/conversations/[id]/turn`.
 *
 * One request = one model round-trip plus execution of whatever tool calls
 * it produced. The response is newline-delimited JSON, one `ChatStreamEvent`
 * per line, so the client can render text as it arrives with a single
 * `JSON.parse` per line and no SSE framing. NDJSON rather than SSE because
 * this is a POST carrying cookies -- `EventSource` cannot make it -- and with
 * `fetch` + `getReader()` on both, SSE's extra parsing buys nothing.
 *
 * The conversation itself is never on this wire in either direction. The
 * server builds the model's transcript from `ai_messages`, and the browser
 * sends only the new message. See 0047 for why that is a trust boundary.
 */

export type TurnMode = "send" | "continue";

export interface TurnRequest {
  mode: TurnMode;
  /** Required when mode is "send"; ignored otherwise. */
  message?: string;
}

export type ChatStreamEvent =
  /** A new assistant message has begun; `text_delta`s follow. */
  | { type: "message_start"; messageId: string }
  | { type: "text_delta"; messageId: string; text: string }
  /**
   * The model asked for a tool. Emitted once the call is COMPLETE -- the
   * adapter assembles fragmented arguments before this fires, so a half
   * received call is never shown, let alone executed.
   */
  | { type: "tool_call"; messageId: string; call: ToolCall; label: string }
  /**
   * A tool finished. `summary` is a short human line for the activity strip;
   * the actual payload stays server-side in `ai_messages` and goes only to
   * the model.
   */
  | { type: "tool_result"; toolCallId: string; name: string; ok: boolean; summary: string }
  | {
      type: "message_end";
      messageId: string;
      stopReason: "text" | "tool_calls" | "interrupted" | "error";
    }
  /**
   * The request is finished. `next: "continue"` means the model wants more
   * tool rounds; the client decides whether to call again immediately or ask
   * the user first (see TierPolicy.autoRounds). `round` counts rounds since
   * the last user message, for that decision.
   */
  | { type: "done"; next: "idle" | "continue"; round: number }
  | {
      type: "error";
      code: ProviderFailure | "rate_limited" | "conversation_busy" | "nothing_pending" | "too_long" | "no_trades";
      message: string;
      retryAfterSeconds?: number;
    };

/** Serialise one event as an NDJSON line. */
export function encodeEvent(event: ChatStreamEvent): string {
  return JSON.stringify(event) + "\n";
}
