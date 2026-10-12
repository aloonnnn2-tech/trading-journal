import { readJsonLimited } from "@/lib/http/read-json";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePaidUser } from "@/lib/ai-keys/guard";
import { deleteApiKey, getDecryptedKey, setApiKeyActive, setApiKeyModel } from "@/lib/ai-keys/queries";
import { getProvider, ProviderError } from "@/lib/ai-keys/providers";
import { isEncryptionConfigured } from "@/lib/ai-keys/crypto";
import { DAY_MS, KEY_CHECKS_PER_DAY, keyCheckDailyBucket } from "@/lib/ai-keys/limits";
import { rateLimit } from "@/lib/rate-limit";
import { scrubString } from "@/lib/observability/scrub";

const patchSchema = z.union([
  z.object({ is_active: z.boolean() }).strict(),
  z
    .object({
      // Printable, no whitespace: every provider's ids fit, and the value
      // ends up in a request URL path for Google.
      model: z.string().trim().min(1).max(200).regex(/^[\w.:/@-]+$/),
    })
    .strict(),
]);

// Enables or disables a stored key without deleting it. This is what makes
// the `is_active` column mean anything from the UI's side -- before this it
// was respected by every read but settable by nothing.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const gate = await requirePaidUser();
  if (!gate.ok) return gate.response;

  // Capped before parsing: a key is at most 500 characters, so 4 KB is
  // generous and nothing bigger is ever buffered.
  const body = await readJsonLimited(request, 4096);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const rawBody = body.value;

  const parsed = patchSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { is_active: boolean } or { model: string }" }, { status: 400 });
  }

  if ("model" in parsed.data) return chooseModelForKey(gate, id, parsed.data.model);

  // Switching a key back on is how a parked (rejected) key returns to use,
  // so it is limited like the other key actions.
  const toggled = await rateLimit(`ai-key-toggle:${gate.userId}`, 20, 60_000);
  if (!toggled.ok) {
    return NextResponse.json(
      { error: "Too many changes in a row — give it a moment." },
      { status: 429, headers: { "Retry-After": String(toggled.retryAfterSeconds) } },
    );
  }
  const updated = await setApiKeyActive(gate.supabase, id, parsed.data.is_active);
  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const gate = await requirePaidUser();
  if (!gate.ok) return gate.response;

  // No explicit ownership check: RLS scopes the delete to the caller, so
  // another user's key id simply matches nothing. That is reported as 404
  // rather than 403 on purpose -- a 403 would confirm the id exists and
  // belongs to someone, which is enough to enumerate valid key ids.
  const deleted = await deleteApiKey(gate.supabase, id);
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * The user picking a model for one key. The pick is checked against the
 * provider's LIVE list with the key itself before it is stored -- a model id
 * that key can't reach would only fail later, on a question. Costs one
 * zero-token /models call, so it shares the key-check rate limits.
 */
async function chooseModelForKey(
  gate: Extract<Awaited<ReturnType<typeof requirePaidUser>>, { ok: true }>,
  id: string,
  model: string,
) {
  const limit = await rateLimit(`ai-key-test:${gate.userId}`, 5, 60_000, { failClosed: true });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many changes in a row — give it a moment." },
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
  if (!isEncryptionConfigured()) {
    return NextResponse.json({ error: "AI features aren't configured on this server yet." }, { status: 503 });
  }

  // includeInactive: choosing a model for a parked key is harmless -- this
  // lists models and sends no journal data.
  const stored = await getDecryptedKey(gate.supabase, id, gate.userId, { includeInactive: true });
  if (!stored) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let offered: string[];
  try {
    const check = await getProvider(stored.provider).validateKey(stored.key);
    if (!check.valid) {
      return NextResponse.json({ error: "That provider rejected this key. Test it for details." }, { status: 400 });
    }
    offered = check.models;
  } catch (err) {
    const detail = err instanceof ProviderError ? err.detail : String(err);
    console.error(`[ai-keys/model] ${stored.provider}:`, scrubString(detail));
    return NextResponse.json(
      { error: "Couldn't reach that provider to check the model. Try again in a moment." },
      { status: 503 },
    );
  }
  // An unreadable list ([]) can't confirm anything, so it can't approve either.
  if (!offered.includes(model)) {
    return NextResponse.json({ error: `${stored.provider} doesn't offer "${model}" to this key.` }, { status: 400 });
  }

  const saved = await setApiKeyModel(gate.supabase, id, model, { validated: true, userId: gate.userId });
  if (saved === "unsupported") {
    return NextResponse.json(
      { error: "Choosing a model needs a database update that hasn't been applied yet (migration 0053)." },
      { status: 503 },
    );
  }
  if (!saved) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(saved);
}
