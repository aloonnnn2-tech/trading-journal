import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_IMAGE_BYTES_PER_USER, MAX_IMAGES_PER_USER } from "@/lib/limits";
import { isMissingColumnError } from "@/lib/supabase/errors";

/**
 * How many screenshots one account keeps, and how many bytes they take
 * (security gaps pass, 5.1). Supabase's free plan gives the whole app 1 GB of
 * file storage, so without a per-account quota one account could fill it for
 * everyone at 30 uploads a minute.
 *
 * bytes is null when 0074 (the size_bytes column) isn't applied yet: the file
 * count still holds then, the byte quota waits for the migration.
 */
export interface ImageUsage {
  files: number;
  bytes: number | null;
}

const PAGE = 1000;

/** Read through the user's own RLS client: it can only ever count their rows. */
export async function getImageUsage(client: SupabaseClient, userId: string): Promise<ImageUsage> {
  let files = 0;
  let bytes = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("trade_images")
      .select("size_bytes")
      .eq("user_id", userId)
      .range(from, from + PAGE - 1);
    if (error) {
      if (!isMissingColumnError(error)) throw error;
      const { count, error: countError } = await client
        .from("trade_images")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);
      if (countError) throw countError;
      return { files: count ?? 0, bytes: null };
    }
    const rows = (data ?? []) as { size_bytes: number | null }[];
    files += rows.length;
    for (const row of rows) bytes += Number(row.size_bytes) || 0;
    if (rows.length < PAGE) break;
  }
  return { files, bytes };
}

function mb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** The message to show when adding `incomingBytes` would break a quota, or null. */
export function imageQuotaError(usage: ImageUsage, incomingBytes: number): string | null {
  if (usage.files >= MAX_IMAGES_PER_USER) {
    return `This account has reached its limit of ${MAX_IMAGES_PER_USER.toLocaleString("en-US")} screenshots. Delete some you no longer need to add more.`;
  }
  if (usage.bytes !== null && usage.bytes + incomingBytes > MAX_IMAGE_BYTES_PER_USER) {
    return `Your screenshots already use ${mb(usage.bytes)} of the ${mb(MAX_IMAGE_BYTES_PER_USER)} this account can store. Delete some you no longer need to add more.`;
  }
  return null;
}
