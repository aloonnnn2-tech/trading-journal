import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt, encrypt, lastFour } from "./crypto";
import type { AIProviderName, StoredApiKey } from "./types";

// All reads and writes here go through the RLS-scoped client
// (src/lib/supabase/server.ts), so "user_api_keys owner access" from 0029
// already restricts every statement to the signed-in user's own rows. Nothing
// in this module needs -- or should get -- the service-role client: a bug that
// leaked one user's key to another would be a credential disclosure, and RLS
// is the safety net that makes that impossible rather than merely unlikely.

// Every select lists columns explicitly and `encrypted_key` is absent from
// this list on purpose. A `select("*")` here would pull ciphertext into the
// route's response object, one careless `NextResponse.json(key)` away from
// shipping it to the browser. The one function that needs it below asks for
// it by name.
const PUBLIC_COLUMNS = "id, provider, label, last_four, is_active, created_at, last_validated_at";

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
  const { data, error } = await supabase
    .from("user_api_keys")
    .select(PUBLIC_COLUMNS)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as StoredApiKey[];
}

export async function createApiKey(
  supabase: SupabaseClient,
  userId: string,
  input: { provider: AIProviderName; key: string; label: string | null },
): Promise<StoredApiKey> {
  const { data, error } = await supabase
    .from("user_api_keys")
    .insert({
      user_id: userId,
      provider: input.provider,
      label: input.label,
      encrypted_key: encrypt(input.key),
      last_four: lastFour(input.key),
      // Callers must have just test-called the provider with this key -- see
      // the POST route. Stamping it here rather than leaving it null is what
      // lets the UI say "verified just now" instead of "never checked".
      last_validated_at: new Date().toISOString(),
    })
    // Returning only the public columns means the freshly-inserted ciphertext
    // never even enters the response object.
    .select(PUBLIC_COLUMNS)
    .single();

  if (error) throw error;
  return data as unknown as StoredApiKey;
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
): Promise<{ provider: AIProviderName; key: string } | null> {
  const { data, error } = await supabase
    .from("user_api_keys")
    .select("provider, encrypted_key")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    provider: data.provider as AIProviderName,
    key: decrypt(data.encrypted_key as string),
  };
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
  const { data, error } = await supabase
    .from("user_api_keys")
    .update({ is_active: isActive })
    .eq("id", id)
    .select(PUBLIC_COLUMNS);

  if (error) throw error;
  return (data?.[0] as unknown as StoredApiKey) ?? null;
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
