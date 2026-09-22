"use client";

import { useCallback, useRef, useState } from "react";
import type { ChatStreamEvent, TurnRequest } from "@/lib/chat/protocol";
import type { TurnView } from "@/lib/chat/fold";
import { labelForTool } from "@/lib/chat/labels";
import type { AIProviderName } from "@/lib/ai-keys/types";

/**
 * Drives one conversation: sends a message, reads the NDJSON stream, folds
 * events into `TurnView[]` (the SAME shape the server produces from stored
 * rows, so a reloaded conversation looks identical to a live one), and
 * decides whether to call the turn endpoint again.
 *
 * The loop lives here, in the browser, on purpose. Each request is one model
 * round-trip; the server reports `done { next: "continue" }` when the model
 * wants more tool rounds and this hook calls again -- up to `autoRounds`
 * times per question, after which it stops and asks the user ("keep
 * going?"). That is what lets a question take as many lookups as it needs
 * without any single request approaching the platform's ceiling.
 */

export type StreamPhase = "idle" | "thinking" | "streaming" | "tools" | "awaiting_keep_going";

export interface StreamError {
  code: string;
  message: string;
  retryAfterSeconds?: number;
  /** Set with code "needs_consent": the provider that must be agreed to first. */
  provider?: AIProviderName;
}

export function useChatStream(opts: {
  conversationId: string | null;
  /** Tool rounds to run automatically per question before asking the user. */
  autoRounds: number;
  initialTurns: TurnView[];
  /** Called after a send completes so the list's title/ordering can refresh. */
  onTurnComplete?: () => void;
}) {
  const [turns, setTurns] = useState<TurnView[]>(opts.initialTurns);
  const [phase, setPhase] = useState<StreamPhase>("idle");
  const [error, setError] = useState<StreamError | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // The last "send" request, so a message refused before it was stored (the
  // provider needed consent first) can be sent again without a new bubble.
  const lastSendRef = useRef<{ message: string; id: string } | null>(null);
  // Refs so the loop reads the latest values without re-creating callbacks.
  const conversationIdRef = useRef(opts.conversationId);
  conversationIdRef.current = opts.conversationId;
  const autoRoundsRef = useRef(opts.autoRounds);
  autoRoundsRef.current = opts.autoRounds;
  const onCompleteRef = useRef(opts.onTurnComplete);
  onCompleteRef.current = opts.onTurnComplete;

  const busy = phase !== "idle" && phase !== "awaiting_keep_going";

  // A conversation whose last turn never reached an answer -- Stop during
  // the lookups, a closed tab mid-loop, a request the platform cut -- can be
  // picked up where it left off: the server re-enters pending tool calls
  // and carries on. Derived from the folded turns, so a reloaded page
  // offers it exactly when a live one would.
  const last = turns[turns.length - 1];
  const needsContinue = phase === "idle" && !error && last !== undefined && last.answer === undefined;

  /** Replace the whole transcript (switching conversations). */
  const reset = useCallback((next: TurnView[]) => {
    abortRef.current?.abort();
    abortRef.current = null;
    lastSendRef.current = null;
    setTurns(next);
    setPhase("idle");
    setError(null);
  }, []);

  const applyEvent = useCallback((event: ChatStreamEvent) => {
    setTurns((prev) => {
      if (prev.length === 0) return prev;
      const last = { ...prev[prev.length - 1], activity: [...prev[prev.length - 1].activity] };
      switch (event.type) {
        case "message_start":
          last.answer = { id: event.messageId, content: "", status: "streaming" };
          break;
        case "text_delta":
          if (last.answer && last.answer.id === event.messageId) {
            last.answer = { ...last.answer, content: last.answer.content + event.text };
          } else {
            last.answer = { id: event.messageId, content: event.text, status: "streaming" };
          }
          break;
        case "tool_call":
          // Shown as activity once the result lands; nothing to render yet.
          break;
        case "tool_result":
          last.activity.push({
            toolCallId: event.toolCallId,
            name: event.name,
            label: labelForTool(event.name),
            ok: event.ok,
          });
          break;
        case "message_end":
          if (event.stopReason === "tool_calls") {
            // A tool-only assistant turn is not an answer; clear the
            // placeholder so the next model call's text starts fresh.
            last.answer = undefined;
          } else if (last.answer) {
            last.answer = {
              ...last.answer,
              status: event.stopReason === "text" ? "complete" : "interrupted",
            };
          }
          break;
        case "error":
          // The server sends message_end before error on the model-call
          // path, but an error from anywhere else (the route's catch-all)
          // arrives with the answer still marked streaming. Whatever is on
          // screen is not the complete answer; say so.
          if (last.answer?.status === "streaming") {
            last.answer = { ...last.answer, status: "interrupted" };
          }
          break;
        default:
          break;
      }
      return [...prev.slice(0, -1), last];
    });
  }, []);

  /** One request to the turn endpoint; resolves to what the server said to do next. */
  const runOnce = useCallback(
    async (body: TurnRequest, id: string): Promise<"idle" | "continue" | "stop"> => {
      const controller = new AbortController();
      abortRef.current = controller;
      setPhase("thinking");
      setError(null);

      let res: Response;
      try {
        res = await fetch(`/api/chat/conversations/${id}/turn`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return "stop";
        setError({ code: "network", message: "Couldn't reach the server. Check your connection and try again." });
        return "stop";
      }

      if (!res.ok || !res.body) {
        const payload = (await res.json().catch(() => null)) as { error?: string; needsConsent?: AIProviderName } | null;
        if (payload?.needsConsent) {
          setError({
            code: "needs_consent",
            message: payload.error ?? "This provider needs your agreement before it can see your journal.",
            provider: payload.needsConsent,
          });
        } else {
          setError({ code: `http_${res.status}`, message: payload?.error ?? "Couldn't get an answer." });
        }
        return "stop";
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let next: "idle" | "continue" | "stop" = "stop";

      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            let event: ChatStreamEvent;
            try {
              event = JSON.parse(line) as ChatStreamEvent;
            } catch {
              continue;
            }
            if (event.type === "text_delta") setPhase("streaming");
            if (event.type === "tool_call") setPhase("tools");
            if (event.type === "error") {
              setError({ code: event.code, message: event.message, retryAfterSeconds: event.retryAfterSeconds });
              next = "stop";
            }
            if (event.type === "done") next = event.next;
            applyEvent(event);
          }
        }
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          setError({ code: "stream", message: "The connection dropped mid-answer. Try again." });
        }
        return "stop";
      } finally {
        reader.releaseLock();
      }
      return next;
    },
    [applyEvent],
  );

  /** Keep calling while the model wants more rounds, up to the tier's gate. */
  const drive = useCallback(
    async (first: TurnRequest, id: string) => {
      let body: TurnRequest = first;
      let autoUsed = 0;
      for (;;) {
        const next = await runOnce(body, id);
        if (next === "stop") {
          setPhase("idle");
          return;
        }
        if (next === "idle") {
          setPhase("idle");
          onCompleteRef.current?.();
          return;
        }
        // next === "continue"
        autoUsed += 1;
        if (autoUsed >= autoRoundsRef.current) {
          setPhase("awaiting_keep_going");
          return;
        }
        body = { mode: "continue" };
      }
    },
    [runOnce],
  );

  /**
   * `conversationId` is passed explicitly rather than read from props: the
   * caller often creates the conversation and sends in the same tick, before
   * React has re-rendered with the new id. Reading a ref there would see the
   * previous value -- null on the very first message -- and silently do
   * nothing.
   */
  const send = useCallback(
    async (message: string, conversationId?: string) => {
      const id = conversationId ?? conversationIdRef.current;
      const text = message.trim();
      if (!text || busy || !id) return;
      lastSendRef.current = { message: text, id };
      setTurns((prev) => [...prev, { user: { id: `local-${Date.now()}`, content: text }, activity: [] }]);
      await drive({ mode: "send", message: text }, id);
    },
    [busy, drive],
  );

  /** Send the last message again, keeping its bubble; for after a consent refusal. */
  const resend = useCallback(async () => {
    const pending = lastSendRef.current;
    if (!pending || busy) return;
    await drive({ mode: "send", message: pending.message }, pending.id);
  }, [busy, drive]);

  /** Another batch of rounds: after "keep going?", or to resume a stranded turn. */
  const continueTurn = useCallback(async () => {
    const id = conversationIdRef.current;
    if (busy || !id) return;
    await drive({ mode: "continue" }, id);
  }, [busy, drive]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("idle");
    // Aborting closes the stream before the server's message_end arrives,
    // so mark the in-flight answer here. The server persists the same
    // status, which is why a reload agrees with this.
    setTurns((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (!last.answer || last.answer.status !== "streaming") return prev;
      return [...prev.slice(0, -1), { ...last, answer: { ...last.answer, status: "interrupted" } }];
    });
  }, []);

  return {
    turns,
    phase,
    busy,
    error,
    needsContinue,
    send,
    resend,
    keepGoing: continueTurn,
    resume: continueTurn,
    stop,
    reset,
    clearError: () => setError(null),
  };
}
