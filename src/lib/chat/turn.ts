import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ProviderError,
  type AIProvider,
  type ChatMessage,
  type ChatResult,
  type ToolCall,
  type ToolDef,
} from "@/lib/ai-keys/providers/types";
import { MAX_ROUNDS_PER_MESSAGE, type TierPolicy } from "@/lib/ai-keys/tier";
import { buildModelMessages } from "./trim";
import { labelForTool } from "./labels";
import {
  insertMessage,
  isBusyError,
  listMessages,
  touchConversation,
  updateMessage,
  MAX_MESSAGES_PER_CONVERSATION,
  type MessageRow,
} from "./queries";
import type { ChatStreamEvent } from "./protocol";

/**
 * One turn of a persisted conversation: at most one model call, plus
 * execution of the tool calls it produced, everything written to
 * `ai_messages` as it happens and narrated to the client through `emit`.
 *
 * This replaces `runToolConversation`. The old orchestrator ran the whole
 * think → tool → think loop inside one request and therefore had to cap it
 * at two or three rounds to fit the platform's 26-second ceiling. Here the
 * loop is driven by the BROWSER: each request does one round and reports
 * `done { next }`, and the client calls again. A question that needs eight
 * lookups takes eight short requests instead of failing to fit into one.
 *
 * Persisting at unit boundaries is what makes that safe. If the platform
 * cuts a request mid-flight, at most one model call is lost: the assistant
 * row is written when the model finishes, each tool row when its executor
 * finishes, and a turn that finds an assistant tool-call row with no
 * matching tool rows simply executes them first ("re-entry").
 */

export interface TurnContext {
  supabase: SupabaseClient;
  userId: string;
  conversationId: string;
  provider: AIProvider;
  apiKey: string;
  policy: TierPolicy;
  /** System prompt (overview + instructions), built by the route per turn. */
  system: string;
  tools: ToolDef[];
  execute: (call: ToolCall) => Promise<string>;
  maxTokens: number;
  /** Absolute ms. The model call and the tools phase both respect it. */
  deadline: number;
  /** The user pressing Stop. */
  signal?: AbortSignal;
  /** Set on mode "send"; undefined on "continue". */
  newMessage?: string;
  /**
   * Whether the conversation already has a title. When it does -- set by an
   * earlier turn or renamed by the user -- this turn leaves it alone.
   */
  hasTitle?: boolean;
}

export type Emit = (event: ChatStreamEvent) => void;

const ANSWER_NOW_WITH_RESULTS =
  "Now write the final answer for the user, using the tool results already provided above. " +
  "Do not request any more tools -- none are available on this turn.";

const ANSWER_NOW_NO_RESULTS =
  "Answer the user's question directly from the overview in the system prompt. " +
  "No tools are available on this turn, so do not refer to tool results or data you have not been given.";

/** Leave at least this much for the tools phase, else defer it to the next turn. */
const MIN_MS_FOR_TOOLS = 4_000;
/** Per-tool executor cap; a slow external fetch must not eat the whole turn. */
const TOOL_TIMEOUT_MS = 3_000;

export async function runTurn(ctx: TurnContext, emit: Emit): Promise<void> {
  const { supabase, userId, conversationId } = ctx;

  let rows = await listMessages(supabase, conversationId, userId);
  if (rows.length >= MAX_MESSAGES_PER_CONVERSATION) {
    emit({
      type: "error",
      code: "too_long",
      message: "This conversation is at its limit. Start a new one to keep going.",
    });
    return;
  }
  let nextSeq = seqAfter(rows);
  // Set once per turn, and only when nothing has named the conversation yet.
  let titled = ctx.hasTitle ?? false;
  const touch = async (messageCount: number) => {
    const title = titled ? null : titleFor(rows);
    await touchConversation(supabase, conversationId, {
      message_count: messageCount,
      ...(title ? { title } : {}),
    });
    if (title) titled = true;
  };

  // ---- 1. Re-entry: tool calls a previous turn never got to run ----------
  //
  // This runs BEFORE the new user message is appended, deliberately. Every
  // provider rejects a transcript where an assistant tool-call turn is not
  // immediately followed by its results, so a stranded round (Stop, a
  // network drop, a deadline miss) must be completed first or the
  // conversation is stuck: with the user's question already appended after
  // the gap, every later model call would fail the same way.
  const pending = pendingToolCalls(rows);
  if (pending) {
    // When the user has moved on to a new question, the old round's results
    // are bookkeeping, not this turn's activity -- run them quietly.
    const quiet = ctx.newMessage !== undefined;
    const outcome = await executeTools(ctx, pending.calls, nextSeq, quiet ? () => undefined : emit, rows);
    if (outcome === "busy") {
      emit({ type: "error", code: "conversation_busy", message: "Another reply is still in progress." });
      return;
    }
    if (outcome === "stopped") return;
    if (outcome === "deferred") {
      await touch(nextSeq);
      return;
    }
    rows = await listMessages(supabase, conversationId, userId);
    nextSeq = seqAfter(rows);
  }

  // A "continue" with nothing to continue -- the last row is a finished
  // answer -- would call the model again with no new input, as often as the
  // client liked. There is nothing pending; say so.
  if (ctx.newMessage === undefined) {
    const last = rows[rows.length - 1];
    if (!last || (last.role === "assistant" && last.status === "complete" && !(last.tool_calls?.length))) {
      emit({ type: "error", code: "nothing_pending", message: "There's nothing to continue. Ask a follow-up instead." });
      return;
    }
  }

  // ---- 2. Persist the new user message (mode "send") ---------------------
  if (ctx.newMessage !== undefined) {
    try {
      const row = await insertMessage(supabase, userId, conversationId, nextSeq, {
        role: "user",
        content: ctx.newMessage,
      });
      rows.push(row);
      nextSeq += 1;
    } catch (err) {
      if (isBusyError(err)) {
        emit({ type: "error", code: "conversation_busy", message: "Another reply is still in progress." });
        return;
      }
      throw err;
    }
  }

  // ---- 3. Round accounting -------------------------------------------------
  const round = roundsSinceLastUser(rows);
  const forceAnswer = round >= MAX_ROUNDS_PER_MESSAGE;

  // ---- 4. One model call -----------------------------------------------------
  const messages = buildModelMessages(rows, ctx.policy);
  const hasToolResults = rows.some((r) => r.role === "tool");
  const offerTools = !forceAnswer;
  const modelMessages: ChatMessage[] = offerTools
    ? messages
    : [...messages, { role: "user", content: hasToolResults ? ANSWER_NOW_WITH_RESULTS : ANSWER_NOW_NO_RESULTS }];

  const remaining = ctx.deadline - Date.now();
  if (remaining < 1_000) {
    emit({ type: "error", code: "unavailable", message: "Ran out of time before the model could answer. Try again." });
    await touch(nextSeq);
    return;
  }

  // The assistant row is created up front so text deltas have an id, and
  // so an interruption leaves an "interrupted" row rather than nothing.
  let assistantRow: MessageRow;
  try {
    assistantRow = await insertMessage(supabase, userId, conversationId, nextSeq, {
      role: "assistant",
      content: "",
      status: "interrupted", // flipped to "complete" on success
    });
  } catch (err) {
    // Two turns racing on one conversation: the loser's seq is taken. The
    // winner is already answering, so this one bows out.
    if (isBusyError(err)) {
      emit({ type: "error", code: "conversation_busy", message: "Another reply is still in progress." });
      return;
    }
    throw err;
  }
  nextSeq += 1;
  emit({ type: "message_start", messageId: assistantRow.id });

  let streamed = "";
  let result: ChatResult;
  try {
    const call = ctx.provider.chatStream ?? adaptOnce(ctx.provider);
    result = await call(
      ctx.apiKey,
      {
        system: ctx.system,
        messages: modelMessages,
        tools: offerTools ? ctx.tools : [],
        maxTokens: ctx.maxTokens,
        timeoutMs: Math.min(20_000, remaining),
      },
      (delta) => {
        streamed += delta;
        emit({ type: "text_delta", messageId: assistantRow.id, text: delta });
      },
      ctx.signal,
    );
  } catch (err) {
    // Keep whatever text arrived, marked so it is never mistaken for done.
    // The row was inserted as "interrupted", so even if this update fails
    // the status is right; only the partial text would be lost.
    await updateMessage(supabase, assistantRow.id, { content: streamed, status: "interrupted" }).catch(() => undefined);
    emit({ type: "message_end", messageId: assistantRow.id, stopReason: "interrupted" });
    const failure = err instanceof ProviderError ? err.failure : "failed";
    emit({
      type: "error",
      code: failure,
      message: messageForFailure(failure, err),
      retryAfterSeconds: err instanceof ProviderError ? err.retryAfterSeconds : undefined,
    });
    // The title is set here too: an interrupted FIRST turn is still a
    // conversation the user will see in the list, and "Untitled" is worse
    // than the question they asked.
    await touch(nextSeq);
    return;
  }

  // ---- 5a. Final text ---------------------------------------------------------
  if (result.kind === "text") {
    // A non-streaming provider delivered everything at once; surface it.
    if (streamed === "" && result.text) {
      emit({ type: "text_delta", messageId: assistantRow.id, text: result.text });
    }
    await updateMessage(supabase, assistantRow.id, { content: result.text, status: "complete" });
    emit({ type: "message_end", messageId: assistantRow.id, stopReason: "text" });
    await touch(nextSeq);
    emit({ type: "done", next: "idle", round });
    return;
  }

  // ---- 5b. Tool calls -----------------------------------------------------------
  await updateMessage(supabase, assistantRow.id, {
    content: result.assistant.content,
    tool_calls: result.calls,
    status: "complete",
  });
  for (const c of result.calls) {
    emit({ type: "tool_call", messageId: assistantRow.id, call: c, label: labelForTool(c.name) });
  }
  emit({ type: "message_end", messageId: assistantRow.id, stopReason: "tool_calls" });

  const outcome = await executeTools(ctx, result.calls, nextSeq, emit, [...rows, assistantRow]);
  if (outcome === "busy") {
    emit({ type: "error", code: "conversation_busy", message: "Another reply is still in progress." });
    return;
  }
  await touch(outcome === "done" ? nextSeq + result.calls.length : nextSeq);
  if (outcome !== "done") return; // deferred (done event already sent) or stopped
  emit({ type: "done", next: "continue", round: round + 1 });
}

// ---- helpers -----------------------------------------------------------------

type ToolsOutcome = "done" | "deferred" | "stopped" | "busy";

/**
 * Runs a round's tools in parallel and persists each result.
 *
 * - "done": every call has a tool row now.
 * - "deferred": not enough time; nothing run, nothing written, `done
 *   {continue}` emitted so the client calls back and re-enters.
 * - "stopped": the user aborted mid-way; nothing written, so the next turn
 *   re-enters and runs the calls for real rather than storing "stopped".
 * - "busy": a concurrent turn owns the next seq.
 *
 * `calls` must already be the ones WITHOUT a result: the caller knows which
 * assistant row owns them and which tool rows follow it. Filtering here
 * against every tool row in the conversation was wrong -- ids are only
 * unique per round on some providers, and an earlier round's result would
 * silently satisfy a new call.
 */
async function executeTools(
  ctx: TurnContext,
  calls: ToolCall[],
  startSeq: number,
  emit: Emit,
  rows: MessageRow[],
): Promise<ToolsOutcome> {
  const { supabase, userId, conversationId } = ctx;
  if (calls.length === 0) return "done";

  if (ctx.signal?.aborted) return "stopped";
  if (ctx.deadline - Date.now() < MIN_MS_FOR_TOOLS) {
    // Not enough time to run them safely. The assistant tool-call row is
    // already persisted; the next turn's re-entry check picks these up.
    emit({ type: "done", next: "continue", round: roundsSinceLastUser(rows) });
    return "deferred";
  }

  const all = Promise.all(
    calls.map(async (call) => {
      const output = await withTimeout(ctx.execute(call), TOOL_TIMEOUT_MS).catch(
        (e: unknown) => JSON.stringify({ error: e instanceof Error ? e.message : "tool failed" }),
      );
      return { call, output: boundOutput(output, ctx.policy.maxToolOutputChars) };
    }),
  );
  // Stop during the tools phase: abandon the round rather than persist
  // half of it. Nothing is written, so re-entry picks the whole round up.
  const results = await Promise.race([all, aborted(ctx.signal)]);
  if (results === null) return "stopped";

  let seq = startSeq;
  for (const { call, output } of results) {
    try {
      await insertMessage(supabase, userId, conversationId, seq, {
        role: "tool",
        content: output,
        tool_call_id: call.id,
        tool_name: call.name,
      });
      seq += 1;
    } catch (err) {
      if (!isBusyError(err)) throw err;
      // 23505 is either the (conversation_id, tool_call_id) index -- a
      // racing turn already stored THIS result, fine -- or the seq index,
      // meaning a concurrent turn is appending. Only re-reading tells which.
      const now = await listMessages(supabase, conversationId, userId);
      if (!now.some((r) => r.role === "tool" && r.tool_call_id === call.id)) return "busy";
      seq = seqAfter(now);
    }
    const ok = !output.startsWith('{"error"');
    emit({ type: "tool_result", toolCallId: call.id, name: call.name, ok, summary: summarise(output) });
  }
  return "done";
}

/** The seq the next row gets: rows are dense and sorted, but never assume that. */
function seqAfter(rows: MessageRow[]): number {
  return rows.reduce((max, r) => Math.max(max, r.seq + 1), 0);
}

/** Resolves to null when the signal fires; never resolves otherwise. */
function aborted(signal: AbortSignal | undefined): Promise<null> {
  return new Promise((resolve) => {
    if (!signal) return;
    if (signal.aborted) resolve(null);
    else signal.addEventListener("abort", () => resolve(null), { once: true });
  });
}

/** The latest assistant tool-call row whose calls have no tool rows yet. */
function pendingToolCalls(rows: MessageRow[]): { calls: ToolCall[] } | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.role === "user") return null;
    if (r.role === "assistant" && r.tool_calls && r.tool_calls.length > 0) {
      // Only results AFTER this row count: an earlier round may have used
      // the same ids on providers that number calls per response.
      const answered = new Set(rows.slice(i + 1).filter((x) => x.role === "tool").map((x) => x.tool_call_id));
      const missing = r.tool_calls.filter((c) => !answered.has(c.id));
      return missing.length > 0 ? { calls: missing } : null;
    }
  }
  return null;
}

/** Tool rounds since the most recent user message. */
function roundsSinceLastUser(rows: MessageRow[]): number {
  let n = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.role === "user") break;
    if (r.role === "assistant" && r.tool_calls && r.tool_calls.length > 0) n += 1;
  }
  return n;
}

/** Heuristic title from the first user message. */
function titleFor(rows: MessageRow[]): string | null {
  const first = rows.find((r) => r.role === "user");
  if (!first) return null;
  const text = first.content.replace(/\s+/g, " ").trim();
  if (text.length <= 60) return text;
  const cut = text.slice(0, 60);
  const space = cut.lastIndexOf(" ");
  return `${space > 30 ? cut.slice(0, space) : cut}…`;
}

/** Non-streaming providers: deliver the text as one delta. */
function adaptOnce(provider: AIProvider) {
  return async (
    apiKey: string,
    input: Parameters<NonNullable<AIProvider["chatOnce"]>>[1],
    onText: (delta: string) => void,
  ): Promise<ChatResult> => {
    if (!provider.chatOnce) throw new ProviderError("failed", "provider has no tool support");
    const result = await provider.chatOnce(apiKey, input);
    if (result.kind === "text") onText(result.text);
    return result;
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("tool timed out")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Replaces an oversized result with a request to narrow it -- never cuts JSON in half. */
function boundOutput(output: string, max: number): string {
  if (output.length <= max) return output;
  return JSON.stringify({
    error: "result too large",
    size: output.length,
    hint: "narrow the filter, lower the limit, or ask for one group at a time",
  });
}

/** Short, content-free line for the activity strip. */
function summarise(output: string): string {
  try {
    const j = JSON.parse(output) as { error?: string; total?: number; items?: unknown[]; trades?: number };
    if (typeof j.error === "string") return j.error.slice(0, 80);
    if (typeof j.total === "number") return `${j.total} matched`;
    if (Array.isArray(j.items)) return `${j.items.length} rows`;
    if (typeof j.trades === "number") return `${j.trades} trades`;
  } catch {
    // not JSON
  }
  return "done";
}

function messageForFailure(failure: string, err: unknown): string {
  switch (failure) {
    case "invalid_key":
      return "That provider rejected your API key. Remove it and add a fresh one.";
    case "model_missing":
      return "That provider no longer offers the model this app asks for.";
    case "truncated":
      return "The model ran out of room before it finished. Try a shorter, more specific question.";
    case "unavailable": {
      const retry = err instanceof ProviderError ? err.retryAfterSeconds : undefined;
      return retry
        ? `That provider is rate-limited right now. Try again in about ${retry} second${retry === 1 ? "" : "s"}.`
        : "That provider is unavailable or rate-limited right now. Try again in a moment.";
    }
    default:
      return "Couldn't get an answer from that provider. Try again.";
  }
}
