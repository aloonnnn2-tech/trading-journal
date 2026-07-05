import type { SupabaseClient } from "@supabase/supabase-js";

// Raster types only — svg is deliberately excluded. An uploaded SVG can embed
// <script>, and since signed URLs are opened directly (not downloaded), the
// browser renders it as HTML rather than a plain image: stored XSS.
export const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export interface TradeImage {
  id: string;
  trade_id: string;
  storage_path: string;
  created_at: string;
}

export interface TradeImageWithUrl extends TradeImage {
  signedUrl: string;
}

export async function listTradeImages(
  supabase: SupabaseClient,
  tradeId: string,
): Promise<TradeImage[]> {
  const { data, error } = await supabase
    .from("trade_images")
    .select("id, trade_id, storage_path, created_at")
    .eq("trade_id", tradeId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as TradeImage[];
}

export async function deleteTradeImageRecord(
  supabase: SupabaseClient,
  imageId: string,
): Promise<void> {
  const { error } = await supabase.from("trade_images").delete().eq("id", imageId);
  if (error) throw error;
}
