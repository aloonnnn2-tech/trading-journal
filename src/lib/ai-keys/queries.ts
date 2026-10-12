import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumnError } from "@/lib/supabase/errors";
import { PROVIDER_MODELS, type AIProviderName, type StoredApiKey } from "./types";
import type { SecretKey } from "./secret";
import { insertKey, readKey, writeKeyModel } from "./vault";

// Public-column reads and the owner's own label/on-off/delete go through the
// RLS-scoped client, so "user_api_keys owner access" (0029) confines them to
// the signed-in user. Anything touching the ciphertext -- storing a key,
// decrypting one, recording its model -- goes through vault.ts, the one
// module allowed near encrypted_key (see its header for why).

// Every select lists columns explicitly and `encrypted_key` is absent from
// this list on purpose. A `select("*")` here would pull ciphertext into the
// route's response object, one careless `NextResponse.json(key)` away from
// shipping it to the browser. The one function that needs it below asks for
// it by name.
const BASE_COLUMNS = "id, provider, label, last_four, is_active, created_at, last_validated_at";
const PUBLIC_COLUMNS = `${BASE_COLUMNS}, model`;
// last_used_at arrives with 0058; model with 0053. Each select tries the
// fullest list first and falls back one migration at a time.
const COLUMN_SETS = [`${PUBLIC_COLUMNS}, last_used_at`, PUBLIC_COLUMNS, BASE_COLUMNS];


/**
 * Upper bound on stored keys per account. Generous -- six providers plus a
 * spare or two -- so it only ever catches runaway or abusive creation, never
 * someone legitimately juggling accounts.
 */
export const MAX_KEYS_PER_USER = 10;

export async function countApiKeys(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from("user_api_keys")
    .select("id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

export async function listApiKeys(supabase: SupabaseClient): Promise<StoredApiKey[]> {
  for (const columns of COLUMN_SETS) {
    const { data, error } = await supabase.from("user_api_keys").select(columns).order("created_at", { ascending: true });
    if (error && isMissingColumnError(error)) continue;
    if (error) throw error;
    return (data ?? []).map((r) => ({ model: null, last_used_at: null, ...(r as object) })) as unknown as StoredApiKey[];
  }
  return [];
}

export async function createApiKey(
  supabase: SupabaseClient,
  userId: string,
  input: { provider: AIProviderName; key: string; label: string | null; model: string | null },
): Promise<StoredApiKey> {
  const row = await insertKey(userId, input);
  return { model: null, last_used_at: null, ...row } as unknown as StoredApiKey;
}

/**
 * Deletes a key. Returns false when nothing matched.
 *
 * RLS scopes the delete to the caller, so a key belonging to someone else
 * simply matches no rows and reports false -- which the route turns into a
 * 404, not a 403. The distinction matters: a 403 would confirm that the id
 * exists and belongs to *someone*, letting an attacker enumerate valid key
 * ids. A 404 says nothing either way.
 */
export async function deleteApiKey(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_api_keys")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/**
 * Fetches one active key and decrypts it, ready to call the provider.
 *
 * **This is the only function that returns plaintext**, and it exists solely
 * to be called server-side inside the ask route immediately before the
 * provider request. Its result must never be put in an API response, logged,
 * or attached to an error. Returns null when the id doesn't match an active
 * key the caller owns -- RLS handles the ownership half.
 */
export async function getDecryptedKey(
  supabase: SupabaseClient,
  id: string,
  userId: string,
  /**
   * Whether a parked (is_active = false) key may be returned.
   *
   * Defaults to false, and every path that sends the user's journal to a
   * provider must keep that default: parking a key is what makes it stop
   * being usable, so a caller that opts out of the filter is opting out of
   * that control. The one legitimate exception is the key-test route, whose
   * entire purpose is to answer "is this parked key actually dead?" -- it
   * calls the provider's model-list endpoint and sends no journal data.
   */
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<{ provider: AIProviderName; key: SecretKey; model: string | null } | null> {
  // Through the vault: decryption is bound to this user, this row and its
  // provider, and a v2 / retired-secret value is upgraded on the way.
  return readKey(userId, id, { includeInactive });
}

/**
 * Enables or disables a key without deleting it. Returns false when nothing
 * matched, which the route turns into a 404.
 *
 * Disabling is what makes `is_active` mean something: the ask route only ever
 * selects active keys, so a parked key stops being usable while its label and
 * masked suffix stay visible. Deleting would be the only alternative, and
 * that loses the record entirely for what is often a temporary problem (a
 * provider account with a billing hold, say).
 */
export async function setApiKeyActive(
  supabase: SupabaseClient,
  id: string,
  isActive: boolean,
): Promise<StoredApiKey | null> {
  for (const columns of COLUMN_SETS) {
    const { data, error } = await supabase.from("user_api_keys").update({ is_active: isActive }).eq("id", id).select(columns);
    if (error && isMissingColumnError(error)) continue;
    if (error) throw error;
    const row = data?.[0];
    return row ? ({ model: null, last_used_at: null, ...(row as object) } as unknown as StoredApiKey) : null;
  }
  return null;
}

/**
 * Records the model a key asks (and, when `validated`, that the provider just
 * accepted it). Returns false when nothing matched -- RLS makes another
 * user's key match nothing, reported as 404 like the other writes.
 *
 * Returns "unsupported" while 0053 isn't applied, so the caller can say a
 * migration is pending instead of failing with a database error.
 */
export async function setApiKeyModel(
  supabase: SupabaseClient,
  id: string,
  model: string,
  { validated = false, userId }: { validated?: boolean; userId: string },
): Promise<StoredApiKey | null | "unsupported"> {
  const row = await writeKeyModel(userId, id, model, validated);
  if (row === "unsupported" || row === null) return row;
  return { last_used_at: null, ...row } as unknown as StoredApiKey;
}

/**
 * Marks a key inactive after the provider rejected it mid-use.
 *
 * Without this a revoked key stays listed as working forever: it was verified
 * once at save time and never re-checked, so the UI keeps offering it and
 * every question through it fails the same way. Best-effort -- a failure here
 * must not replace the useful "your key was rejected" message the caller is
 * about to return with a database error.
 */
export async function markApiKeyInvalid(supabase: SupabaseClient, id: string): Promise<void> {
  try {
    await supabase.from("user_api_keys").update({ is_active: false }).eq("id", id);
  } catch {
    // Intentionally swallowed; see above.
  }
}

/**
 * Provider and model of one ACTIVE key, without decrypting it -- for routes
 * that only need to label a conversation. Null when the id doesn't resolve
 * (someone else's key under RLS, or a parked one).
 */
export async function getActiveKeyMeta(
  supabase: SupabaseClient,
  id: string,
): Promise<{ provider: AIProviderName; model: string } | null> {
  const select = (columns: string) =>
    supabase
      .from("user_api_keys")
      .select(columns)
      .eq("id", id)
      .eq("is_active", true)
      .maybeSingle<{ provider: string; model?: string | null }>();

  let { data, error } = await select("provider, model");
  if (error && isMissingColumnError(error)) ({ data, error } = await select("provider"));
  if (error) throw error;
  if (!data) return null;
  const provider = data.provider as AIProviderName;
  return { provider, model: data.model ?? PROVIDER_MODELS[provider] };
}
