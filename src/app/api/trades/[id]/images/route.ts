import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTrade } from "@/lib/trades/queries";
import { ALLOWED_IMAGE_TYPES } from "@/lib/images/queries";

const BUCKET = "trade-images";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

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
  const supabase = await createClient();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
  const storagePath = `${userData.user.id}/${id}/${crypto.randomUUID()}.${ext}`;
  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: file.type });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: inserted, error: insertError } = await supabase
    .from("trade_images")
    .insert({ trade_id: id, user_id: userData.user.id, storage_path: storagePath })
    .select("id, trade_id, storage_path, created_at")
    .single();

  if (insertError) {
    // Clean up orphaned storage file
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 3600);

  return NextResponse.json(
    { ...inserted, url: signed?.signedUrl ?? null },
    { status: 201 },
  );
}
