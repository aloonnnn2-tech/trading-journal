import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AskImage } from "./providers/types";

// Ask looking at a trade's chart screenshots (Alon, 2026-10-17).
//
// The image never enters the conversation's stored rows: a tool row records
// only the image's id (ai_messages.parts, reserved for this by 0047), and the
// bytes are downloaded and re-encoded here for each request of the question
// that asked for them -- through the asker's own RLS client, so only their
// own screenshots can ever be read. Earlier questions get no image at all,
// just the tool's short text result.

/**
 * Whether the chat may show this conversation's model a chart:
 * - "unsupported": the provider's models are text-only (the screenshot
 *   import's list -- src/lib/ocr/ai-providers.ts);
 * - "no_consent": capable, but the user hasn't switched it on for this
 *   provider (consent scope "chat_images_v1");
 * - "on".
 */
export type VisionState = "on" | "no_consent" | "unsupported";

/** Charts one question may look at. Every one is re-sent each round of the question. */
export const MAX_IMAGES_PER_QUESTION = 3;

/** Long edge, in px: the largest Anthropic uses without downscaling, and plenty to read a chart. */
const MAX_SIDE = 1568;

export interface TradeImageRef {
  id: string;
  trade_id: string;
  storage_path: string;
}

/** The screenshot row, if it is the asker's own (RLS) -- null otherwise. */
export async function findTradeImage(supabase: SupabaseClient, id: string): Promise<TradeImageRef | null> {
  const { data, error } = await supabase
    .from("trade_images")
    .select("id, trade_id, storage_path")
    .eq("id", id)
    .maybeSingle();
  if (error) return null;
  return (data as TradeImageRef | null) ?? null;
}

/**
 * The screenshot as the model gets it: first frame, EXIF orientation applied,
 * at most MAX_SIDE on the long edge, JPEG. Null when it can't be read.
 */
export async function loadChartImage(supabase: SupabaseClient, imageId: string): Promise<AskImage | null> {
  const ref = await findTradeImage(supabase, imageId);
  if (!ref) return null;
  const { data, error } = await supabase.storage.from("trade-images").download(ref.storage_path);
  if (error || !data) return null;
  try {
    const jpeg = await sharp(Buffer.from(await data.arrayBuffer()), { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { mime: "image/jpeg", base64: jpeg.toString("base64") };
  } catch {
    return null;
  }
}
