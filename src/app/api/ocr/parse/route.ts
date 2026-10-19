// Offline OCR endpoint. Accepts a screenshot, runs the local parsing pipeline
// (PaddleOCR + semantic parser — no external API, no keys), and returns the
// structured ParseResult. Never 500s on a bad image: the pipeline always
// returns a partial result, so the client gets something to work with.

import { NextResponse } from "next/server";
import { detectImageKind } from "@/lib/images/magic";
import { accuracyLogLine, findPossibleDuplicates } from "@/lib/ocr/duplicates";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { logEvent, SERVER_SESSION_ID } from "@/lib/tracking/log";
import { ALLOWED_IMAGE_TYPES } from "@/lib/images/queries";
import { runOcrPipeline } from "@/lib/ocr/pipeline";
import { rateLimit } from "@/lib/rate-limit";
import { enforceDailyCap } from "@/lib/rate-limits/daily";
import { MAX_UPLOAD_BYTES, UPLOAD_TOO_LARGE } from "@/lib/http/upload-limits";
import { log } from "@/lib/observability/log";

// Native modules (onnxruntime-node, sharp) require the Node.js runtime.
export const runtime = "nodejs";
// OCR can take a few seconds on a cold model load; allow headroom.
export const maxDuration = 60;

const MAX_BYTES = MAX_UPLOAD_BYTES;

// The most expensive route in the app by a wide margin: a 4 MB upload into a
// CPU-bound native OCR pipeline with a 60s budget, all of it billed Netlify
// compute. 20/minute is far above real use (the UI scans one screenshot at a
// time, taking seconds each) while capping what a looping client can spend.
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

export async function POST(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = await rateLimit(`ocr:${userId}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many scans in a row — give it a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const daily = await enforceDailyCap("ocr", userId);
  if (daily) return daily;

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
    return NextResponse.json({ error: UPLOAD_TOO_LARGE }, { status: 400 });
  }

  // Covers both a corrupt/truncated upload stream failing to read here and
  // runOcrPipeline itself (which is designed never to throw, but a native
  // module fault is guarded regardless) — either way this route must not 500.
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    // The declared type is the client's claim (guessed from the file name);
    // the first bytes are the file. Only a real image reaches the OCR engine.
    if (!detectImageKind(buffer)) {
      return NextResponse.json(
        { error: "That file isn't a JPEG, PNG, WebP or GIF image." },
        { status: 400 },
      );
    }
    const result = await runOcrPipeline(buffer);
    // The caller's RLS client: logs the usage event, and looks for trades of
    // their own that this one may duplicate (never anyone else's).
    const supabase = await createClient();
    result.duplicates = await findPossibleDuplicates(supabase, result).catch(() => []);
    log.info("ocr.read", accuracyLogLine(result));
    void logEvent(userId, SERVER_SESSION_ID, "screenshot_parsed", {});
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "OCR failed";
    return NextResponse.json(
      { ok: false, core: {}, extra: [], screenshotType: "unknown", broker: null, warnings: [], error: message },
      { status: 200 },
    );
  }
}
