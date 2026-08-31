import { NextResponse } from "next/server";
import { requirePaidUser } from "@/lib/ai-keys/guard";
import { getDecryptedKey, markApiKeyInvalid } from "@/lib/ai-keys/queries";
import { askAiSchema } from "@/lib/ai-keys/schema";
import { buildJournalContext, buildSystemPrompt } from "@/lib/ai-keys/context";
import { getProvider, providerModel, ProviderError } from "@/lib/ai-keys/providers";
import { isEncryptionConfigured } from "@/lib/ai-keys/crypto";
import { hasConsent } from "@/lib/ai-keys/consent";
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

  // Checked before anything reaches the crypto module -- otherwise a
  // deployment missing the secret fails inside decrypt() as an unhandled
  // exception, i.e. a bare 500 with nothing to act on, at exactly the moment
  // a fresh deployment is most likely to be missing the variable.
  if (!isEncryptionConfigured()) {
    return NextResponse.json(
      {
        error:
          "AI features aren't configured on this server yet (missing AI_KEY_ENCRYPTION_SECRET). Contact whoever deployed it.",
      },
      { status: 503 },
    );
  }

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

  // RLS scopes this to the caller, so another user's key id simply doesn't
  // resolve -- there is no way to ask a question on someone else's key.
  const stored = await getDecryptedKey(gate.supabase, parsed.data.keyId);
  if (!stored) {
    return NextResponse.json(
      { error: "That key isn't available. Pick another one, or add a new key." },
      { status: 400 },
    );
  }

  // Enforced server-side, not only in the UI. This is the request that
  // actually discloses the journal to a third party, so it is the right place
  // to require the agreement -- a client that skipped the dialog, or a stale
  // tab from before consent was withdrawn, must not get through.
  let consented: boolean;
  try {
    consented = await hasConsent(gate.supabase, stored.provider);
  } catch (err) {
    // Almost always the ai_provider_consents table not existing yet, i.e.
    // migration 0031 hasn't been applied. Fails CLOSED -- nothing is sent to
    // any provider -- and says what to do, rather than surfacing as the bare
    // 500 that an unhandled database error would produce.
    console.error("[ask-ai] consent lookup failed:", err);
    return NextResponse.json(
      {
        error:
          "AI features aren't fully set up on this server yet (a database migration is pending). Contact whoever deployed it.",
      },
      { status: 503 },
    );
  }

  if (!consented) {
    return NextResponse.json(
      {
        error: `You haven't agreed to send your journal to ${stored.provider} yet.`,
        needsConsent: stored.provider,
      },
      { status: 403 },
    );
  }

  const settings = await getUserSettings(gate.supabase, gate.userId);
  // Built with the same RLS-scoped client, so it can only ever contain this
  // user's own trades.
  const context = await buildJournalContext(gate.supabase, settings.timezone);

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
    const answer = await getProvider(stored.provider).askQuestion(
      stored.key,
      buildSystemPrompt(context),
      parsed.data.question,
    );
    return NextResponse.json({ answer });
  } catch (err) {
    // Distinct outcomes, because they need different actions from the user.
    // The provider's own error text is logged, never returned -- those bodies
    // can echo back parts of the request, which here would mean echoing the
    // journal context into an HTTP response.
    const failure = err instanceof ProviderError ? err.failure : "failed";
    const detail = err instanceof ProviderError ? err.detail : String(err);
    console.error(`[ask-ai] ${stored.provider} ${failure}:`, detail);

    if (failure === "invalid_key") {
      // Park the key rather than leaving it listed as working. It was verified
      // once at save time and never re-checked, so without this the UI keeps
      // offering a revoked key and every question through it fails the same
      // way with no indication that the key itself is the thing to fix.
      await markApiKeyInvalid(gate.supabase, parsed.data.keyId);
      return NextResponse.json(
        {
          error:
            "That provider rejected your API key, so it's been switched off. It was probably revoked or rotated — remove it and add a fresh one.",
        },
        { status: 502 },
      );
    }
    if (failure === "model_missing") {
      return NextResponse.json(
        {
          error: `${stored.provider} no longer offers the model this app asks for (${providerModel(stored.provider)}). Your key is fine — this needs updating in the app.`,
        },
        { status: 502 },
      );
    }
    if (failure === "truncated") {
      return NextResponse.json(
        {
          error:
            "The model ran out of room before it finished answering. Try a shorter, more specific question.",
        },
        { status: 502 },
      );
    }
    if (failure === "unavailable") {
      return NextResponse.json(
        {
          error:
            "That provider is unavailable right now, or you've hit its rate limit or quota. Try again in a moment.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "Couldn't get an answer from that provider. Try again, or try a different key." },
      { status: 502 },
    );
  }
}
