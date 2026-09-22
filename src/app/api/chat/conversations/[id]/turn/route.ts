import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePaidUser } from "@/lib/ai-keys/guard";
import { preflightProviderCall } from "@/lib/ai-keys/preflight";
import { buildToolOverview, buildToolSystemPrompt } from "@/lib/ai-keys/context";
import { getProvider, MAX_ANSWER_TOKENS } from "@/lib/ai-keys/providers";
import { TradeStore, makeToolExecutor, toolDefsFor } from "@/lib/ai-keys/tools";
import { tierPolicyFor } from "@/lib/ai-keys/tier";
import { claimTurn, getConversation, releaseTurn } from "@/lib/chat/queries";
import { encodeEvent, type ChatStreamEvent } from "@/lib/chat/protocol";
import { runTurn } from "@/lib/chat/turn";
import { getUserSettings } from "@/lib/settings/queries";
import { rateLimit } from "@/lib/rate-limit";
import { logEvent, SERVER_SESSION_ID } from "@/lib/tracking/log";

// One turn of a conversation, streamed back as newline-delimited JSON.
//
// The platform ends any request at 26 s. Everything below budgets against a
// deadline well inside that so the LAST event the client sees is ours -- a
// clean `error` or `done` -- rather than the platform's own 502. runTurn
// persists at unit boundaries, so even a hard cut loses at most one model
// call, and the next request picks up where it stopped.
export const maxDuration = 26;

/** Wall-clock budget for the whole turn, from the top of the handler. */
const TURN_BUDGET_MS = 22_000;

// Per-turn: a driven loop makes many short requests, so this is generous.
// Per-message: new questions are what cost provider tokens on a free tier.
const TURN_LIMIT = 60;
const MESSAGE_LIMIT = 20;
const WINDOW_MS = 60_000;

const bodySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("send"),
    message: z
      .string()
      .trim()
      .min(1)
      .max(4_000)
      // Postgres text cannot hold NUL; it would fail the insert with a
      // generic error instead of this clean 400.
      .refine((s) => !s.includes("\u0000"), "message contains an invalid character"),
  }),
  z.object({ mode: z.literal("continue") }),
]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now();
  const { id } = await params;

  const gate = await requirePaidUser();
  if (!gate.ok) return gate.response;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const turnLimit = await rateLimit(`chat-turn:${gate.userId}`, TURN_LIMIT, WINDOW_MS);
  if (!turnLimit.ok) return tooMany(turnLimit.retryAfterSeconds);

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Expected { mode: "send", message } or { mode: "continue" }' }, { status: 400 });
  }

  if (parsed.data.mode === "send") {
    const msgLimit = await rateLimit(`chat-message:${gate.userId}`, MESSAGE_LIMIT, WINDOW_MS);
    if (!msgLimit.ok) return tooMany(msgLimit.retryAfterSeconds);
  }

  // RLS: someone else's conversation id does not resolve. 404, not 403.
  const conversation = await getConversation(gate.supabase, id);
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!conversation.key_id) {
    return NextResponse.json(
      { error: "The key this conversation used has been removed. Pick another key for it." },
      { status: 409 },
    );
  }

  // Encryption configured, key resolvable, and this provider consented to
  // under the CHAT scope -- the chat discloses more than the review paths,
  // so their consent does not carry over. The decrypted key lives only in
  // this call frame and the turn that follows.
  const ready = await preflightProviderCall(gate.supabase, conversation.key_id, gate.userId, "chat_v2");
  if (!ready.ok) return ready.response;

  const provider = getProvider(ready.provider);
  if (!provider.chatOnce && !provider.chatStream) {
    return NextResponse.json({ error: "This provider can't hold a conversation with tools." }, { status: 400 });
  }

  const settings = await getUserSettings(gate.supabase, gate.userId);
  const overview = await buildToolOverview(gate.supabase, settings.timezone);
  if (overview.totalTrades === 0) {
    return NextResponse.json(
      { error: "There are no trades in your journal yet. Log a trade and then ask again." },
      { status: 400 },
    );
  }

  const policy = tierPolicyFor(ready.provider);
  const userId = gate.userId;
  const supabase = gate.supabase;

  // One turn at a time per conversation. The seq index serialises row
  // inserts, not the model call between them, so without this claim two
  // requests arriving within the same 20 s both called the model on the same
  // transcript. Released in the stream's finally; the TTL covers a request
  // the platform kills before it gets there.
  if (!(await claimTurn(supabase, id))) {
    return NextResponse.json({ error: "Another reply is still in progress." }, { status: 409 });
  }
  // One store for the whole turn, so the tools of a round share a single
  // journal fetch. (The overview above reads its own headline summary; it
  // is a count and a few aggregates, not the per-trade rows the store holds.)
  const store = new TradeStore(supabase, settings.timezone);
  const mode = parsed.data.mode;
  const newMessage = parsed.data.mode === "send" ? parsed.data.message : undefined;

  // The response is a stream. Events are written as runTurn emits them; the
  // stream closes when it returns. Any throw becomes a final error event so
  // the client never sees a socket close with no explanation.
  const encoder = new TextEncoder();
  // Once the client goes away (Stop, tab closed, network drop) the stream is
  // cancelled and enqueue() throws. That must not abort runTurn: the row
  // updates and the conversation's message_count/title are written AFTER
  // some emits, and a thrown emit was silently skipping them -- leaving an
  // interrupted conversation with count 0, hidden from the list. So emit
  // becomes a no-op once the consumer is gone; persistence carries on.
  let clientGone = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: ChatStreamEvent) => {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(encodeEvent(event)));
        } catch {
          clientGone = true;
        }
      };
      try {
        await runTurn(
          {
            supabase,
            userId,
            conversationId: id,
            provider,
            apiKey: ready.key,
            policy,
            system: buildToolSystemPrompt(overview),
            tools: toolDefsFor(policy),
            execute: makeToolExecutor(supabase, settings.timezone, store, policy.maxToolOutputChars),
            maxTokens: MAX_ANSWER_TOKENS,
            deadline: startedAt + TURN_BUDGET_MS,
            signal: request.signal,
            newMessage,
            hasTitle: conversation.title !== null,
          },
          emit,
        );
        if (mode === "send") {
          void logEvent(supabase, userId, SERVER_SESSION_ID, "ai_question_answered", {
            provider: ready.provider,
            mode: "chat",
          });
        }
      } catch (err) {
        console.error("[chat/turn] failed:", err instanceof Error ? err.message : err);
        emit({ type: "error", code: "failed", message: "Something went wrong on our side. Try again." });
      } finally {
        await releaseTurn(supabase, id);
        if (!clientGone) {
          try {
            controller.close();
          } catch {
            // already closed by cancellation
          }
        }
      }
    },
    cancel() {
      clientGone = true;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // Every layer between here and the browser is told not to buffer,
      // which is what makes text appear as it is written.
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

function tooMany(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many requests in a row. Give it a moment." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}
