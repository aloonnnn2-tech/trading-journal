import { NextResponse } from "next/server";
import { requirePaidUser } from "@/lib/ai-keys/guard";
import { getDecryptedKey, markApiKeyInvalid } from "@/lib/ai-keys/queries";
import { getProvider, providerModel, ProviderError } from "@/lib/ai-keys/providers";
import { isEncryptionConfigured } from "@/lib/ai-keys/crypto";
import { rateLimit } from "@/lib/rate-limit";

// Re-checks a stored key against its provider, on demand.
//
// Keys are verified once at save time and never again, so a key revoked at
// the provider stays listed as working until a question fails through it. The
// failure path does park the key (markApiKeyInvalid), but the user is then
// left with a row labelled "off" that looks identical to one they switched
// off themselves. This route is the missing way to ask "is this key still
// good?" without spending a question to find out.
//
// Deliberately NOT using preflightProviderCall: that gate exists to protect
// *journal disclosure*, and requires provider consent. Testing a key calls
// the provider's model-list endpoint and sends none of the user's data, so
// requiring consent here would block a diagnostic that discloses nothing.
// The decrypted key still goes straight into the provider call and nowhere
// else -- never into a response, a log, or an error.

// Same budget as adding a key: every call here is an outbound request to a
// third party from this app's IP, and testing is a deliberate, rare action.
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const gate = await requirePaidUser();
  if (!gate.ok) return gate.response;

  const limit = await rateLimit(`ai-key-test:${gate.userId}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many checks in a row — give it a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  if (!isEncryptionConfigured()) {
    return NextResponse.json(
      {
        error:
          "AI features aren't configured on this server yet (missing AI_KEY_ENCRYPTION_SECRET). Contact whoever deployed it.",
      },
      { status: 503 },
    );
  }

  // RLS scopes this to the caller, so another user's key id simply doesn't
  // resolve. 404 rather than 403, matching DELETE in the sibling route: a 403
  // would confirm the id exists and belongs to someone.
  // includeInactive: a parked key is exactly the one worth testing -- the
  // user needs to know whether the provider rejected it or they switched it
  // off themselves. Safe here because this route sends no journal data.
  const stored = await getDecryptedKey(gate.supabase, id, gate.userId, { includeInactive: true });
  if (!stored) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let valid: boolean;
  try {
    valid = await getProvider(stored.provider).validateKey(stored.key);
  } catch (err) {
    const failure = err instanceof ProviderError ? err.failure : "failed";
    const detail = err instanceof ProviderError ? err.detail : String(err);
    console.error(`[ai-keys/test] ${stored.provider} ${failure}:`, detail);

    // The key authenticated but the model is gone. Reported as its own state
    // because the key is fine and telling the user to replace it would send
    // them the wrong way entirely.
    if (failure === "model_missing") {
      return NextResponse.json({
        ok: false,
        state: "model_missing",
        message: `Your key works, but ${stored.provider} no longer offers the model this app uses (${providerModel(stored.provider)}). This needs updating in the app — it isn't something you can fix.`,
      });
    }

    return NextResponse.json({
      ok: false,
      state: "unreachable",
      message: "Couldn't reach that provider just now. It may be a temporary outage — try again in a moment.",
    });
  }

  if (!valid) {
    // Park it, exactly as a failed question would. A key that just failed an
    // explicit check should not stay listed as usable.
    await markApiKeyInvalid(gate.supabase, id);
    return NextResponse.json({
      ok: false,
      state: "rejected",
      message: "That provider rejected this key, so it's been switched off. It was probably revoked or rotated — remove it and add a fresh one.",
    });
  }

  return NextResponse.json({
    ok: true,
    state: "working",
    message: `Working — ${stored.provider} accepted this key and still offers ${providerModel(stored.provider)}.`,
  });
}
