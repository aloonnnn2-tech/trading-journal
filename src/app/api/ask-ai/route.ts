import { NextResponse } from "next/server";
import { requirePaidUser } from "@/lib/ai-keys/guard";
import { preflightProviderCall } from "@/lib/ai-keys/preflight";
import { providerErrorResponse } from "@/lib/ai-keys/provider-error-response";
import { askAiSchema } from "@/lib/ai-keys/schema";
import {
  buildJournalContext,
  buildSystemPrompt,
  buildToolOverview,
  buildToolSystemPrompt,
  contextBudgetFor,
  historyBudgetFor,
  trimHistory,
} from "@/lib/ai-keys/context";
import { getProvider, MAX_ANSWER_TOKENS, ProviderError } from "@/lib/ai-keys/providers";
import { FREE_TIER_PROVIDERS } from "@/lib/ai-keys/types";
import { runToolConversation } from "@/lib/ai-keys/providers/orchestrator";
import { TOOL_DEFS, makeToolExecutor } from "@/lib/ai-keys/tools";
import { getUserSettings } from "@/lib/settings/queries";
import { rateLimit } from "@/lib/rate-limit";
import { logEvent, SERVER_SESSION_ID } from "@/lib/tracking/log";

// The AI cost sits on the user's own key, but this route still does several
// DB reads to build the context and then proxies an outbound call, so it
// needs the same abuse guard as the OCR route. Asking a question is a
// deliberate, one-at-a-time action; 15/minute is far above real use.
const RATE_LIMIT = 15;
const RATE_WINDOW_MS = 60_000;

// Deliberately modest, and lower than a slow provider might plausibly take.
// The hosting platform enforces its own ceiling on how long a request may
// run, and if it fires first the user gets the platform's generic error page
// instead of one of the specific messages below. Staying under that keeps
// failures inside this app's own error handling, where they can be explained.
export const maxDuration = 26;

// Shared by both paths, so the tool path and the single-shot fallback can
// never drift into giving the same failure two different explanations.
const TRUNCATED_HINT =
  "The model ran out of room before it finished answering. Try a shorter, more specific question.";

// Every turn re-sends the earlier ones, so a long conversation costs more
// tokens per question than a fresh one -- on a free tier that is what runs
// the per-minute budget out first.
const CONVERSATION_LENGTH_HINT =
  "This was a follow-up, and each turn re-sends the conversation so far. Starting a new conversation asks for less at once.";

export async function POST(request: Request) {
  const gate = await requirePaidUser();
  if (!gate.ok) return gate.response;

  const limit = await rateLimit(`ask-ai:${gate.userId}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many questions in a row — give it a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = askAiSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid question" },
      { status: 400 },
    );
  }

  // Encryption configured, key resolvable, and this provider consented to --
  // every precondition for disclosing the journal to a third party. Shared
  // with the AI review routes so all three enforce it identically.
  const ready = await preflightProviderCall(gate.supabase, parsed.data.keyId, gate.userId);
  if (!ready.ok) return ready.response;

  const settings = await getUserSettings(gate.supabase, gate.userId);
  const provider = getProvider(ready.provider);
  const startedAt = Date.now();
  // Whether this question carried earlier turns, used only to decide if a
  // failure is worth blaming on conversation length.
  const hadHistory = (parsed.data.history ?? []).length > 0;

  const noTradesResponse = () =>
    NextResponse.json(
      { error: "There are no trades in your journal yet. Log a trade and then ask again." },
      { status: 400 },
    );

  // The agentic path: when the provider can call functions, send a short
  // overview and let the model fetch and compute exact figures via the tools
  // (src/lib/ai-keys/tools.ts) instead of reasoning over a whole-journal text
  // dump. On ANY tool-path failure it drops to the single-shot path below, so
  // a provider or model that stumbles on tool use never leaves the user worse
  // off than before this existed.
  if (provider.chatOnce) {
    try {
      const overview = await buildToolOverview(gate.supabase, settings.timezone);
      if (overview.totalTrades === 0) return noTradesResponse();

      const toolHistory = trimHistory(parsed.data.history ?? [], historyBudgetFor(ready.provider));
      // The free tiers cap tokens-per-minute, and every tool round-trip re-sends
      // the conversation, so they get fewer rounds and tighter per-call timeouts.
      // Sourced from the one free-tier set (src/lib/ai-keys/types.ts) so a
      // provider added there is covered here without a second edit.
      const freeTier = FREE_TIER_PROVIDERS.has(ready.provider);

      const result = await runToolConversation(provider, {
        apiKey: ready.key,
        system: buildToolSystemPrompt(overview),
        question: parsed.data.question,
        history: toolHistory,
        tools: TOOL_DEFS,
        execute: makeToolExecutor(gate.supabase, settings.timezone),
        maxTokens: MAX_ANSWER_TOKENS,
        maxIterations: freeTier ? 2 : 3,
        // Leave headroom under maxDuration so the fallback path can still run.
        deadline: startedAt + 16_000,
        perCallTimeoutMs: freeTier ? 11_000 : 14_000,
      });
      void logEvent(gate.supabase, gate.userId, SERVER_SESSION_ID, "ai_question_answered", {
        provider: ready.provider,
        mode: "tools",
      });
      return NextResponse.json({ answer: result.answer, steps: result.steps });
    } catch (err) {
      // Falling back means immediately sending a LARGER request: the whole
      // journal instead of a short overview. That is the right move when the
      // tool path failed for a reason the single-shot path might survive --
      // a model that stumbles on tool use, a malformed tool call, a timeout.
      //
      // It is the wrong move for a rate limit or a rejected key. Neither gets
      // better by retrying bigger: the second call fails identically, having
      // spent more of the user's per-minute token budget on the way, which on
      // a free tier is exactly what deepens the limit that caused this. Report
      // those directly instead.
      if (
        err instanceof ProviderError &&
        (err.failure === "unavailable" || err.failure === "invalid_key")
      ) {
        return providerErrorResponse(err, {
          supabase: gate.supabase,
          provider: ready.provider,
          keyId: parsed.data.keyId,
          logPrefix: "ask-ai tools",
          truncatedHint: TRUNCATED_HINT,
          // A long conversation re-sends every earlier answer on each turn,
          // so this is the first thing that starts failing once the feature
          // gets useful. Say so -- the user has a one-click fix for it.
          hint: hadHistory ? CONVERSATION_LENGTH_HINT : undefined,
        });
      }
      // Log `detail`, not just `message`: ProviderError's message is the
      // generic "Provider request failed: <failure>", so without this a
      // tool-path failure is unattributable in production -- which is exactly
      // the hole that made this class of bug hard to diagnose.
      console.warn(
        "ask-ai tool path failed, falling back:",
        err instanceof ProviderError ? `${err.failure}: ${err.detail}` : err,
      );
    }
  }

  // Single-shot fallback: the whole journal in the system prompt, one call.
  // Conversation first, because what survives trimming decides how much room
  // is left for the journal -- both share one budget, see contextBudgetFor.
  const history = trimHistory(parsed.data.history ?? [], historyBudgetFor(ready.provider));
  const historyChars = history.reduce((n, turn) => n + turn.content.length + 1, 0);

  // Same RLS-scoped client, so it can only ever contain this user's own trades,
  // rebuilt fresh each turn so a follow-up after logging a trade sees it.
  const context = await buildJournalContext(
    gate.supabase,
    settings.timezone,
    contextBudgetFor(ready.provider, historyChars),
  );

  if (context.totalTrades === 0) return noTradesResponse();

  try {
    const answer = await provider.askQuestion(ready.key, buildSystemPrompt(context), parsed.data.question, {
      history,
      // Never let the fallback push the request past the platform ceiling
      // after the tool path already spent part of the budget.
      timeoutMs: Math.max(6_000, startedAt + 24_000 - Date.now()),
    });
    void logEvent(gate.supabase, gate.userId, SERVER_SESSION_ID, "ai_question_answered", {
      provider: ready.provider,
      mode: "single-shot",
    });
    return NextResponse.json({ answer });
  } catch (err) {
    return providerErrorResponse(err, {
      supabase: gate.supabase,
      provider: ready.provider,
      keyId: parsed.data.keyId,
      logPrefix: "ask-ai",
      truncatedHint: TRUNCATED_HINT,
      hint: hadHistory ? CONVERSATION_LENGTH_HINT : undefined,
    });
  }
}
