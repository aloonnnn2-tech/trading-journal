import { readJsonLimited } from "@/lib/http/read-json";
import { NextResponse } from "next/server";
import { requirePaidUser } from "@/lib/ai-keys/guard";
import { countApiKeys, createApiKey, listApiKeys, MAX_KEYS_PER_USER } from "@/lib/ai-keys/queries";
import { apiKeyCreateSchema } from "@/lib/ai-keys/schema";
import { getProvider, ProviderError, type KeyCheck } from "@/lib/ai-keys/providers";
import { chooseModel } from "@/lib/ai-keys/providers/model-check";
import { isEncryptionConfigured } from "@/lib/ai-keys/crypto";
import { DAY_MS, KEY_CHECKS_PER_DAY, keyCheckDailyBucket } from "@/lib/ai-keys/limits";
import { rateLimit } from "@/lib/rate-limit";
import { logEvent, SERVER_SESSION_ID } from "@/lib/tracking/log";
import { log } from "@/lib/observability/log";

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
// OpenAI/Anthropic/Google from this app's IP -- and, worse, use this server
// as an oracle for checking a list of stolen keys. Adding a key is a rare,
// deliberate action: five a minute is far above real use, and the daily cap
// (shared with the key-test route, see limits.ts) is what bounds the oracle.
const RATE_LIMIT = 5;
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

  const limit = await rateLimit(`ai-keys:${gate.userId}`, RATE_LIMIT, RATE_WINDOW_MS, { failClosed: true });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many attempts in a row — give it a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  const daily = await rateLimit(keyCheckDailyBucket(gate.userId), KEY_CHECKS_PER_DAY, DAY_MS, { failClosed: true });
  if (!daily.ok) {
    return NextResponse.json(
      { error: "That's the daily limit for checking keys. Try again tomorrow." },
      { status: 429, headers: { "Retry-After": String(daily.retryAfterSeconds) } },
    );
  }

  // Capped before parsing: a key is at most 500 characters, so 4 KB is
  // generous and nothing bigger is ever buffered.
  const body = await readJsonLimited(request, 4096);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const rawBody = body.value;

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
  let check: KeyCheck;
  try {
    check = await getProvider(provider).validateKey(key);
  } catch (err) {
    const failure = err instanceof ProviderError ? err.failure : "failed";
    const detail = err instanceof ProviderError ? err.detail : String(err);
    // Scrubbed: a provider's error body can echo the request, key included.
    log.error("ai_keys.validate_failed", { provider, failure, detail });

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

  if (!check.valid) {
    return NextResponse.json(
      {
        error:
          "That provider rejected the key. Check you copied all of it, that it isn't revoked, and that it matches the provider you picked.",
      },
      { status: 400 },
    );
  }

  // Pick the model from the provider's LIVE list, so a retired default can't
  // produce a key that fails on its first question. Null only when the list
  // was readable and holds none of this app's choices: then the app, not the
  // user's key, needs updating, and saving would just defer the failure.
  const model = chooseModel(provider, check.models);
  if (!model) {
    log.error("ai_keys.no_known_model", { provider, liveModels: check.models.length });
    return NextResponse.json(
      {
        error: `Your key works, but none of the models this app knows for ${provider} are offered to it any more. This needs updating in the app — it isn't something you can fix. Another provider will work meanwhile.`,
      },
      { status: 503 },
    );
  }

  const created = await createApiKey(gate.supabase, gate.userId, { provider, key, label, model });
  void logEvent(gate.userId, SERVER_SESSION_ID, "ai_key_added", { provider });
  // createApiKey returns only the masked public columns -- the plaintext key
  // ends here and is never echoed back.
  return NextResponse.json(created, { status: 201 });
}
