import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { getTrade } from "@/lib/trades/queries";
import sharp from "sharp";
import { ALLOWED_IMAGE_TYPES } from "@/lib/images/queries";

const BUCKET = "trade-images";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

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
 * GIF is passed through untouched: the format has no EXIF container to leak,
 * and re-encoding would flatten an animation for no benefit.
 */
async function stripMetadata(buffer: Buffer, mime: string): Promise<Buffer> {
  if (mime === "image/gif") return buffer;

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
    return NextResponse.json({ error: "File exceeds 5 MB limit" }, { status: 400 });
  }

  const ext = EXT_BY_MIME[file.type] ?? "jpg";
  const storagePath = `${userId}/${id}/${crypto.randomUUID()}.${ext}`;
  const arrayBuffer = await file.arrayBuffer();

  // A decode failure here means the bytes are not the image the declared MIME
  // type claims -- the type check above reads the client's header, which is
  // free to lie. Rejecting is the point: it also means nothing unparseable
  // reaches storage to be served back later.
  let buffer: Buffer;
  try {
    buffer = await stripMetadata(Buffer.from(arrayBuffer), file.type);
  } catch {
    return NextResponse.json(
      { error: "That image couldn't be processed. It may be corrupt or too large." },
      { status: 400 },
    );
  }

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: file.type });

  if (uploadError) {
    console.error("[images] upload failed:", uploadError);
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
    console.error("[images] row insert failed:", insertError);
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
