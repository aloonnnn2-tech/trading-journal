// Offline OCR endpoint. Accepts a screenshot, runs the local parsing pipeline
// (PaddleOCR + semantic parser — no external API, no keys), and returns the
// structured ParseResult. Never 500s on a bad image: the pipeline always
// returns a partial result, so the client gets something to work with.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ALLOWED_IMAGE_TYPES } from "@/lib/images/queries";
import { runOcrPipeline } from "@/lib/ocr/pipeline";

// Native modules (onnxruntime-node, sharp) require the Node.js runtime.
export const runtime = "nodejs";
// OCR can take a few seconds on a cold model load; allow headroom.
export const maxDuration = 60;

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let file: FormDataEntryValue | null;
  try {
    const formData = await request.formData();
    file = formData.get("file");
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

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

  // Covers both a corrupt/truncated upload stream failing to read here and
  // runOcrPipeline itself (which is designed never to throw, but a native
  // module fault is guarded regardless) — either way this route must not 500.
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await runOcrPipeline(buffer);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "OCR failed";
    return NextResponse.json(
      { ok: false, core: {}, extra: [], screenshotType: "unknown", broker: null, error: message },
      { status: 200 },
    );
  }
}
