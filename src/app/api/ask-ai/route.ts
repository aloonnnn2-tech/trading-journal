import { NextResponse } from "next/server";
import { requirePaidUser } from "@/lib/ai-keys/guard";
import { preflightProviderCall } from "@/lib/ai-keys/preflight";
import { providerErrorResponse } from "@/lib/ai-keys/provider-error-response";
import { askAiSchema } from "@/lib/ai-keys/schema";
import {
  buildJournalContext,
  buildSystemPrompt,
  contextBudgetFor,
  historyBudgetFor,
  trimHistory,
} from "@/lib/ai-keys/context";
import { getProvider } from "@/lib/ai-keys/providers";
import { getUserSettings } from "@/lib/settings/queries";
import { rateLimit } from "@/lib/rate-limit";

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

export async function POST(request: Request) {
  const gate = await requirePaidUser();
  if (!gate.ok) return gate.response;

  const limit = rateLimit(`ask-ai:${gate.userId}`, RATE_LIMIT, RATE_WINDOW_MS);
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

  // Conversation first, because what survives trimming decides how much room
  // is left for the journal. Both are sent on every turn and both are charged
  // to the same per-minute allowance, so they share one budget rather than
  // each having their own -- see contextBudgetFor.
  const history = trimHistory(parsed.data.history ?? [], historyBudgetFor(ready.provider));
  const historyChars = history.reduce((n, turn) => n + turn.content.length + 1, 0);

  // Built with the same RLS-scoped client, so it can only ever contain this
  // user's own trades. Rebuilt fresh on every turn rather than carried along
  // in the conversation, so a follow-up asked after logging a trade sees that
  // trade instead of answering from a snapshot taken minutes ago.
  const context = await buildJournalContext(
    gate.supabase,
    settings.timezone,
    contextBudgetFor(ready.provider, historyChars),
  );

  // Checked against every position, not just closed ones: a journal holding
  // only open trades still has entries, sizing, strategies and notes worth
  // asking about, and refusing there would be wrong.
  if (context.totalTrades === 0) {
    return NextResponse.json(
      { error: "There are no trades in your journal yet. Log a trade and then ask again." },
      { status: 400 },
    );
  }

  try {
    const answer = await getProvider(ready.provider).askQuestion(
      ready.key,
      buildSystemPrompt(context),
      parsed.data.question,
      { history },
    );
    return NextResponse.json({ answer });
  } catch (err) {
    return providerErrorResponse(err, {
      supabase: gate.supabase,
      provider: ready.provider,
      keyId: parsed.data.keyId,
      logPrefix: "ask-ai",
      truncatedHint:
        "The model ran out of room before it finished answering. Try a shorter, more specific question.",
    });
  }
}
