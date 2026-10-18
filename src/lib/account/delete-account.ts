import type { SupabaseClient } from "@supabase/supabase-js";

// Account deletion's clean-up of what doesn't cascade with the auth user
// (security gaps pass, 5.3). Table rows go with the user (every user_id
// references auth.users on delete cascade); files in Storage and the
// waitlist row (keyed by email, not user id) do not.

export const IMAGE_BUCKET = "trade-images";
const PAGE = 1000;
const REMOVE_CHUNK = 100;

type Storage = SupabaseClient["storage"];

/** Every file under `prefix`, walking folders (a folder has no id). */
async function listFolder(storage: Storage, prefix: string): Promise<string[]> {
  const files: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await storage.from(IMAGE_BUCKET).list(prefix, { limit: PAGE, offset });
    if (error) throw error;
    const entries = data ?? [];
    for (const entry of entries) {
      const full = `${prefix}/${entry.name}`;
      if (entry.id === null) files.push(...(await listFolder(storage, full)));
      else files.push(full);
    }
    if (entries.length < PAGE) break;
  }
  return files;
}

/**
 * Removes every screenshot the user has: the whole `{userId}/` folder, which
 * also catches files whose trade_images row is already gone, plus any path a
 * row still names. Runs with the service role, so a path is only ever taken
 * from inside the user's own folder -- a storage_path someone wrote into
 * their own row can never point this at another account's files.
 *
 * Throws on any Storage error, so the caller can stop before deleting the
 * account: a deleted account whose files remain could never be cleaned up
 * from the app again.
 */
export async function removeUserFiles(storage: Storage, userId: string, knownPaths: string[]): Promise<number> {
  const own = `${userId}/`;
  const paths = new Set((await listFolder(storage, userId)).filter((p) => p.startsWith(own)));
  for (const p of knownPaths) if (p.startsWith(own) && !p.includes("..")) paths.add(p);
  const all = [...paths];
  for (let i = 0; i < all.length; i += REMOVE_CHUNK) {
    const { error } = await storage.from(IMAGE_BUCKET).remove(all.slice(i, i + REMOVE_CHUNK));
    if (error) throw error;
  }
  return all.length;
}

/**
 * Removes the waitlist row for this email, if there is one. The list keeps
 * the address as typed (unique on lower(email)), and PostgREST's ilike reads
 * `*` and `_` as wildcards, so ilike only finds candidates; a row is deleted
 * only when it is this address, ignoring case.
 */
export async function removeWaitlistEmail(admin: SupabaseClient, email: string): Promise<number> {
  const wanted = email.trim().toLowerCase();
  if (!wanted) return 0;
  const { data, error } = await admin.from("waitlist").select("id, email").ilike("email", wanted).limit(50);
  if (error) throw error;
  const ids = ((data ?? []) as { id: string; email: string }[])
    .filter((row) => row.email.trim().toLowerCase() === wanted)
    .map((row) => row.id);
  if (ids.length === 0) return 0;
  const { error: deleteError } = await admin.from("waitlist").delete().in("id", ids);
  if (deleteError) throw deleteError;
  return ids.length;
}
