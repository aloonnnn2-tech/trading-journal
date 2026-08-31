import { NextResponse } from "next/server";
import { requirePaidUser } from "@/lib/ai-keys/guard";
import { countApiKeys, createApiKey, listApiKeys, MAX_KEYS_PER_USER } from "@/lib/ai-keys/queries";
import { apiKeyCreateSchema } from "@/lib/ai-keys/schema";
import { getProvider, providerModel, ProviderError } from "@/lib/ai-keys/providers";
import { isEncryptionConfigured } from "@/lib/ai-keys/crypto";
import { rateLimit } from "@/lib/rate-limit";

export async function GET() {
  const gate = await requirePaidUser();
  if (!gate.ok) return gate.response;

  // listApiKeys selects an explicit column list that excludes encrypted_key,
  // so there is no ciphertext in this response to accidentally serialize.
  const keys = await listApiKeys(gate.supabase);
  return NextResponse.json(keys);
}

// Each save makes an outbound call to a third-party provider, so an
// unthrottled endpoint lets one looping client generate traffic against
// OpenAI/Anthropic/Google from this app's IP. Adding a key is a rare,
// deliberate action -- 10/minute is far above real use while capping that.
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

export async function POST(request: Request) {
  const gate = await requirePaidUser();
  if (!gate.ok) return gate.response;

  // Checked before anything else touches the crypto module. Without this the
  // missing-secret error surfaces from deep inside encrypt() as an unhandled
  // exception -- a bare 500 with nothing to act on, at exactly the moment a
  // fresh deployment is most likely to be missing the variable.
  if (!isEncryptionConfigured()) {
    return NextResponse.json(
      {
        error:
          "AI features aren't configured on this server yet (missing AI_KEY_ENCRYPTION_SECRET). Contact whoever deployed it.",
      },
      { status: 503 },
    );
  }

  const limit = rateLimit(`ai-keys:${gate.userId}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many attempts in a row — give it a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = apiKeyCreateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid API key" },
      { status: 400 },
    );
  }

  const { provider, key, label } = parsed.data;

  // Nothing else bounds how many rows one account can create here, and each
  // one is a stored secret. A generous cap keeps a stuck client (or a bored
  // user) from filling the table without ever getting in the way of real use.
  if ((await countApiKeys(gate.supabase)) >= MAX_KEYS_PER_USER) {
    return NextResponse.json(
      {
        error: `You can store up to ${MAX_KEYS_PER_USER} keys. Remove one before adding another.`,
      },
      { status: 400 },
    );
  }

  // Test the key against the real provider BEFORE storing anything. Skipping
  // this would save a broken key silently, and the user would discover it as
  // a confusing failure the first time they asked a question -- long after
  // the moment when "that key was rejected" is actionable.
  let valid: boolean;
  try {
    valid = await getProvider(provider).validateKey(key);
  } catch (err) {
    const failure = err instanceof ProviderError ? err.failure : "failed";
    const detail = err instanceof ProviderError ? err.detail : String(err);
    console.error(`[ai-keys] validate ${provider} ${failure}:`, detail);

    // The key authenticated, but the model this app asks for is gone. Saving
    // would produce a key that fails on its first question, so refuse now and
    // name the cause -- the user's key is not the problem and telling them to
    // check it would send them the wrong way entirely.
    if (failure === "model_missing") {
      return NextResponse.json(
        {
          error: `Your key works, but ${provider} no longer offers the model this app uses (${providerModel(provider)}). This needs updating in the app — it isn't something you can fix.`,
        },
        { status: 503 },
      );
    }

    // Couldn't reach the provider at all. Deliberately *not* saved: an
    // unverified key is exactly what this step exists to prevent, and asking
    // the user to retry in a moment is better than storing something we
    // couldn't check.
    return NextResponse.json(
      {
        error:
          "Couldn't reach that provider to check the key. It may be a temporary outage — try again in a moment.",
      },
      { status: 503 },
    );
  }

  if (!valid) {
    return NextResponse.json(
      {
        error:
          "That provider rejected the key. Check you copied all of it, that it isn't revoked, and that it matches the provider you picked.",
      },
      { status: 400 },
    );
  }

  const created = await createApiKey(gate.supabase, gate.userId, { provider, key, label });
  // createApiKey returns only the masked public columns -- the plaintext key
  // ends here and is never echoed back.
  return NextResponse.json(created, { status: 201 });
}
