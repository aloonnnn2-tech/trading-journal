import { NextResponse } from "next/server";
import { requirePaidUser } from "@/lib/ai-keys/guard";
import { getDecryptedKey, markApiKeyInvalid, setApiKeyModel } from "@/lib/ai-keys/queries";
import { getProvider, providerModel, ProviderError, type KeyCheck } from "@/lib/ai-keys/providers";
import { chooseModel, pickerModels } from "@/lib/ai-keys/providers/model-check";
import { isEncryptionConfigured } from "@/lib/ai-keys/crypto";
import { DAY_MS, KEY_CHECKS_PER_DAY, keyCheckDailyBucket } from "@/lib/ai-keys/limits";
import { rateLimit } from "@/lib/rate-limit";
import { log } from "@/lib/observability/log";

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
//
// It also keeps the key's model current: the provider's live model list comes
// back with the check, so a model that was retired since the key was saved is
// replaced here with the next choice the provider still offers, and the list
// is returned for the model picker.
// The decrypted key still goes straight into the provider call and nowhere
// else -- never into a response, a log, or an error.

// Same budget as adding a key: every call here is an outbound request to a
// third party from this app's IP, and testing is a deliberate, rare action.
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const gate = await requirePaidUser();
  if (!gate.ok) return gate.response;

  const limit = await rateLimit(`ai-key-test:${gate.userId}`, RATE_LIMIT, RATE_WINDOW_MS, { failClosed: true });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many checks in a row — give it a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  // Shares the save route's daily bucket: together they are the only two
  // places this server will check a key against a provider.
  const daily = await rateLimit(keyCheckDailyBucket(gate.userId), KEY_CHECKS_PER_DAY, DAY_MS, { failClosed: true });
  if (!daily.ok) {
    return NextResponse.json(
      { error: "That's the daily limit for checking keys. Try again tomorrow." },
      { status: 429, headers: { "Retry-After": String(daily.retryAfterSeconds) } },
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

  let check: KeyCheck;
  try {
    check = await getProvider(stored.provider).validateKey(stored.key);
  } catch (err) {
    const failure = err instanceof ProviderError ? err.failure : "failed";
    const detail = err instanceof ProviderError ? err.detail : String(err);
    log.error("ai_keys.test_failed", { provider: stored.provider, failure, detail });

    return NextResponse.json({
      ok: false,
      state: "unreachable",
      message: "Couldn't reach that provider just now. It may be a temporary outage — try again in a moment.",
    });
  }

  if (!check.valid) {
    // Park it, exactly as a failed question would. A key that just failed an
    // explicit check should not stay listed as usable.
    await markApiKeyInvalid(gate.supabase, id);
    return NextResponse.json({
      ok: false,
      state: "rejected",
      message: "That provider rejected this key, so it's been switched off. It was probably revoked or rotated — remove it and add a fresh one.",
    });
  }

  const current = stored.model ?? providerModel(stored.provider);
  const models = pickerModels(stored.provider, check.models);
  const chosen = chooseModel(stored.provider, check.models, current);

  // The key authenticated but the provider offers none of the models this app
  // knows. Its own state, because the key is fine and telling the user to
  // replace it would send them the wrong way entirely -- they can still pick
  // any model from the list.
  if (!chosen) {
    return NextResponse.json({
      ok: false,
      state: "model_missing",
      model: current,
      models,
      message: `Your key works, but ${stored.provider} no longer offers ${current}. Pick another model for this key below.`,
    });
  }

  // Record the pick (it heals a retired model) and the successful check.
  // "unsupported" = 0053 not applied: the key still works on the first choice.
  const saved = await setApiKeyModel(gate.supabase, id, chosen, { validated: true, userId: gate.userId });
  const switched = chosen !== current && saved !== "unsupported";

  return NextResponse.json({
    ok: true,
    state: "working",
    model: saved === "unsupported" ? current : chosen,
    models,
    message: switched
      ? `Working — ${stored.provider} no longer offers ${current}, so this key now uses ${chosen}.`
      : `Working — ${stored.provider} accepted this key and still offers ${chosen}.`,
  });
}
