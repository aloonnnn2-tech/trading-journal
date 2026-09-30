import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingColumnError } from "@/lib/supabase/errors";
import { decryptWithMeta, encrypt, lastFour } from "./crypto";
import { SecretKey } from "./secret";
import type { AIProviderName } from "./types";

// The ONLY module that reads or writes `user_api_keys.encrypted_key`
// (vault.test.ts enforces that). Everything else sees a key as its public
// columns: provider, label, last four characters, model, dates.
//
// Why the service-role client here, when the rest of the app leans on RLS:
// migration 0058 takes the ciphertext column (and inserting keys, and
// changing a key's provider) away from the `authenticated` role entirely.
// A stolen session or an XSS -- which acts with the user's own JWT straight
// against the database -- then can't read the ciphertext, plant a key, or
// point a key at another provider. The server still can, through this file,
// and every statement below is filtered by the user id the verified session
// supplied (never by anything from the request body).
//
// Before 0058 is applied the RLS client works too, so it is the fallback when
// the service-role key isn't configured (local setups without it).

function client(fallback: SupabaseClient): SupabaseClient {
  try {
    return createAdminClient();
  } catch {
    return fallback;
  }
}

const RETURNED = "id, provider, label, last_four, is_active, created_at, last_validated_at";

/**
 * Stores a new key. The row id is chosen here so the ciphertext can be bound
 * to it (v3: user + row + provider) before the row exists.
 */
export async function insertKey(
  rls: SupabaseClient,
  userId: string,
  input: { provider: AIProviderName; key: string; label: string | null; model: string | null },
): Promise<Record<string, unknown>> {
  const db = client(rls);
  const id = crypto.randomUUID();
  const row = {
    id,
    user_id: userId,
    provider: input.provider,
    label: input.label,
    encrypted_key: encrypt(input.key, userId, { keyId: id, provider: input.provider }),
    last_four: lastFour(input.key),
    // Callers have just test-called the provider with this key (POST route).
    last_validated_at: new Date().toISOString(),
  };
  // Only public columns come back: the ciphertext never enters a response.
  const { data, error } = await db.from("user_api_keys").insert({ ...row, model: input.model }).select(`${RETURNED}, model`).single();
  if (error && isMissingColumnError(error)) {
    const base = await db.from("user_api_keys").insert(row).select(RETURNED).single();
    if (base.error) throw base.error;
    return { ...base.data, model: null };
  }
  if (error) throw error;
  return data as Record<string, unknown>;
}

/**
 * One key, decrypted and wrapped, ready for a provider request -- or null if
 * the id isn't the user's (or is parked, unless includeInactive).
 *
 * Records the use (last_used_at, 0058) and upgrades the stored ciphertext
 * when it is v2 or under a retired secret; both in the background, both
 * allowed to fail silently -- the user's request must not fail over them.
 */
export async function readKey(
  rls: SupabaseClient,
  userId: string,
  id: string,
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<{ provider: AIProviderName; key: SecretKey; model: string | null } | null> {
  const db = client(rls);
  const select = (columns: string) => {
    let q = db.from("user_api_keys").select(columns).eq("id", id).eq("user_id", userId);
    if (!includeInactive) q = q.eq("is_active", true);
    return q.maybeSingle<{ provider: string; encrypted_key: string; model?: string | null }>();
  };
  let { data, error } = await select("provider, encrypted_key, model");
  if (error && isMissingColumnError(error)) ({ data, error } = await select("provider, encrypted_key"));
  if (error) throw error;
  if (!data) return null;

  const binding = { keyId: id, provider: data.provider };
  const { plaintext, stale } = decryptWithMeta(data.encrypted_key, userId, binding);

  if (stale) {
    void db
      .from("user_api_keys")
      .update({ encrypted_key: encrypt(plaintext, userId, binding) })
      .eq("id", id)
      .eq("user_id", userId)
      .then(
        () => undefined,
        () => undefined,
      );
  }
  void db
    .from("user_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .then(
      () => undefined,
      () => undefined,
    );

  return { provider: data.provider as AIProviderName, key: new SecretKey(plaintext), model: data.model ?? null };
}

/**
 * Records a key's model (0053) and, with `validated`, that the provider just
 * accepted it. "unsupported" while 0053 isn't applied; null if not the user's.
 */
export async function writeKeyModel(
  rls: SupabaseClient,
  userId: string,
  id: string,
  model: string,
  validated: boolean,
): Promise<Record<string, unknown> | null | "unsupported"> {
  const db = client(rls);
  const patch: Record<string, unknown> = { model };
  if (validated) patch.last_validated_at = new Date().toISOString();
  const { data, error } = await db
    .from("user_api_keys")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId)
    .select(`${RETURNED}, model`);
  if (error && isMissingColumnError(error)) return "unsupported";
  if (error) throw error;
  return (data?.[0] as Record<string, unknown>) ?? null;
}
