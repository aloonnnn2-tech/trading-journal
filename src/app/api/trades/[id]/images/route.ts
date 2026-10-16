import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { getTrade } from "@/lib/trades/queries";
import sharp from "sharp";
import { ALLOWED_IMAGE_TYPES } from "@/lib/images/queries";
import { detectImageKind, MIME_BY_KIND } from "@/lib/images/magic";
import { enforceRateLimit } from "@/lib/rate-limit";
import { MAX_UPLOAD_BYTES, UPLOAD_TOO_LARGE } from "@/lib/http/upload-limits";
import { log } from "@/lib/observability/log";

const BUCKET = "trade-images";
const MAX_BYTES = MAX_UPLOAD_BYTES;

// Same reasoning as the OCR route: the byte cap bounds the upload, not what
// gets decoded. Re-encoding below decodes the image, so it needs its own
// pixel ceiling or a decompression bomb lands here instead.
const MAX_PIXELS = 50_000_000;

/**
 * Strips embedded metadata by re-encoding.
 *
 * A phone photo of a trading screen carries EXIF, which routinely includes
 * GPS coordinates, device serial and capture time. Uploads are stored
 * verbatim and handed back through signed URLs, so that metadata rides along
 * with the image and travels wherever the user shares the link -- a home
 * address attached to a trade screenshot. sharp drops all metadata unless
 * withMetadata() is called, so a plain re-encode into the same format is the
 * whole fix; the rotate() first bakes in EXIF orientation so discarding the
 * tag doesn't leave the image sideways.
 *
 * GIF keeps its original bytes -- the format has no EXIF container to leak,
 * and re-encoding would flatten an animation for no benefit -- but it is
 * still decoded first, so a non-image payload wearing an image/gif MIME is
 * rejected rather than stored. animated:true so a multi-frame GIF validates
 * as a whole instead of only its first page.
 */
async function stripMetadata(buffer: Buffer, mime: string): Promise<Buffer> {
  if (mime === "image/gif") {
    // Decoding alone proved only that sharp could read SOMETHING: its
    // prebuilt binaries also decode SVG, so an SVG (scriptable when opened
    // directly) labelled image/gif would decode fine and then be stored as
    // its original bytes. The decoded format must actually be GIF.
    const meta = await sharp(buffer, { limitInputPixels: MAX_PIXELS, animated: true }).metadata();
    if (meta.format !== "gif") throw new Error("not a gif");
    return buffer;
  }

  const img = sharp(buffer, { limitInputPixels: MAX_PIXELS }).rotate();
  if (mime === "image/png") return await img.png().toBuffer();
  if (mime === "image/webp") return await img.webp().toBuffer();
  return await img.jpeg({ quality: 90 }).toBuffer();
}

// Extension is derived from the *validated* content type, never from the
// uploaded filename. `file.name.split(".").pop()` returned whatever followed
// the last dot in a fully client-controlled string -- a name like
// `chart.png/../../elsewhere` yields an "extension" containing slashes and
// `..`, which went straight into the storage object key. The MIME type has
// already been checked against ALLOWED_IMAGE_TYPES by the time this is
// used, so the lookup always resolves.
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Each upload is up to 4 MB of decode-and-re-encode through sharp, which is CPU
  // the deploy is billed for. 30/min is far more than anyone attaches to a
  // trade by hand.
  const limited = await enforceRateLimit(
    `image-upload:${userId}`,
    30,
    60_000,
    "Too many uploads in a row. Give it a moment and try again.",
  );
  if (limited) return limited;

  const supabase = await createClient();

  const trade = await getTrade(supabase, id);
  if (!trade) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Unsupported image type. Use JPEG, PNG, WebP, or GIF." },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: UPLOAD_TOO_LARGE }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();

  // The declared type is the client's claim (browsers guess it from the file
  // name); the first bytes are the file. Everything below -- extension,
  // re-encode, stored content type -- follows the bytes. A PNG saved as
  // .jpg still works; an SVG or HTML page labelled image/gif does not.
  const kind = detectImageKind(new Uint8Array(arrayBuffer));
  if (!kind) {
    return NextResponse.json(
      { error: "That file isn't a JPEG, PNG, WebP or GIF image." },
      { status: 400 },
    );
  }
  const mime = MIME_BY_KIND[kind];
  const ext = EXT_BY_MIME[mime] ?? "jpg";
  const storagePath = `${userId}/${id}/${crypto.randomUUID()}.${ext}`;

  // A decode failure here means the bytes are not the image the declared MIME
  // type claims -- the type check above reads the client's header, which is
  // free to lie. Rejecting is the point: it also means nothing unparseable
  // reaches storage to be served back later.
  let buffer: Buffer;
  try {
    buffer = await stripMetadata(Buffer.from(arrayBuffer), mime);
  } catch {
    return NextResponse.json(
      { error: "That image couldn't be processed. It may be corrupt or too large." },
      { status: 400 },
    );
  }

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: mime });

  if (uploadError) {
    log.error("images.upload_failed", { error: uploadError });
    return NextResponse.json({ error: "Could not store the image." }, { status: 500 });
  }

  const { data: inserted, error: insertError } = await supabase
    .from("trade_images")
    .insert({ trade_id: id, user_id: userId, storage_path: storagePath })
    .select("id, trade_id, storage_path, created_at")
    .single();

  if (insertError) {
    // Clean up orphaned storage file
    await supabase.storage.from(BUCKET).remove([storagePath]);
    log.error("images.row_insert_failed", { error: insertError });
    return NextResponse.json({ error: "Could not save the image." }, { status: 500 });
  }

  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 3600);

  return NextResponse.json(
    { ...inserted, url: signed?.signedUrl ?? null },
    { status: 201 },
  );
}
