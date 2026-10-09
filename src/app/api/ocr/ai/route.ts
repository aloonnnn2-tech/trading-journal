// "Read with AI" for screenshot import (Problem 2, part 2 of the hardening
// brief). Paid plan, the user's OWN AI key, and their explicit agreement to
// send screenshots to that provider ("screenshot_v1"). The offline reader
// (/api/ocr/parse) stays the default; this is a second opinion the user asks
// for. Nothing is saved here -- the reply fills the same review screen, where
// the user confirms every value before a trade exists.
//
// The app never holds a usable key: preflightProviderCall decrypts the
// user's key for this one call, server-side, and it goes nowhere else.

import { NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { requirePaidUser } from "@/lib/ai-keys/guard";
import { preflightProviderCall } from "@/lib/ai-keys/preflight";
import { providerErrorResponse } from "@/lib/ai-keys/provider-error-response";
import { getProvider } from "@/lib/ai-keys/providers";
import { withRetiredModelRetry } from "@/lib/ai-keys/repick-model";
import { generateStructured, StructuredOutputError } from "@/lib/ai-reviews/parse";
import { detectImageKind } from "@/lib/images/magic";
import {
  AI_SCHEMA_HINT,
  AI_SYSTEM_PROMPT,
  AI_USER_PROMPT,
  aiReplySchema,
  aiReplyToResult,
  SCREENSHOT_AI_PROVIDERS,
} from "@/lib/ocr/ai-extract";
import { accuracyLogLine, findPossibleDuplicates } from "@/lib/ocr/duplicates";
import { logError } from "@/lib/observability/scrub";
import { rateLimit } from "@/lib/rate-limit";
import { enforceDailyCap } from "@/lib/rate-limits/daily";

export const runtime = "nodejs";
export const maxDuration = 45;

const MAX_BYTES = 5 * 1024 * 1024;
// Big enough to keep small print legible, small enough for every provider's
// per-image limit once base64-encoded.
const MAX_SIDE = 2000;
const PROVIDER_BUDGET_MS = 38_000;
const MAX_TOKENS = 2_500;

const keyIdSchema = z.uuid();

export async function POST(request: Request) {
  const startedAt = Date.now();
  const gate = await requirePaidUser();
  if (!gate.ok) return gate.response;

  const limit = await rateLimit(`screenshot-ai:${gate.userId}`, 10, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many AI reads in a row. Give it a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  const daily = await enforceDailyCap("screenshot-ai", gate.userId);
  if (daily) return daily;

  let file: FormDataEntryValue | null;
  let keyId: FormDataEntryValue | null;
  try {
    const form = await request.formData();
    file = form.get("file");
    keyId = form.get("keyId");
  } catch {
    return NextResponse.json({ error: "Expected a screenshot and a key." }, { status: 400 });
  }
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File exceeds 5 MB limit" }, { status: 400 });
  const parsedKey = keyIdSchema.safeParse(keyId);
  if (!parsedKey.success) return NextResponse.json({ error: "Pick which saved key to use." }, { status: 400 });

  const original = Buffer.from(await file.arrayBuffer());
  if (!detectImageKind(original)) {
    return NextResponse.json({ error: "That file isn't a JPEG, PNG, WebP or GIF image." }, { status: 400 });
  }

  // Key resolvable, encryption configured, and THIS provider agreed to for
  // screenshots. Nothing leaves the server before this passes.
  const ready = await preflightProviderCall(gate.supabase, parsedKey.data, gate.userId, "screenshot_v1");
  if (!ready.ok) return ready.response;
  if (!SCREENSHOT_AI_PROVIDERS.has(ready.provider)) {
    return NextResponse.json(
      { error: "This key's provider can't read images. Use an OpenAI, Anthropic, Google, Mistral or OpenRouter key." },
      { status: 400 },
    );
  }

  // Re-encoded: metadata (EXIF, GPS) stripped, size bounded, one format.
  let jpeg: Buffer;
  try {
    jpeg = await sharp(original, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch {
    return NextResponse.json({ error: "That image couldn't be processed." }, { status: 400 });
  }

  const provider = getProvider(ready.provider);
  let usedModel = ready.model;
  let reply;
  try {
    reply = await withRetiredModelRetry(
      (model) => {
        usedModel = model;
        return generateStructured({
          provider,
          apiKey: ready.key,
          model,
          systemPrompt: AI_SYSTEM_PROMPT,
          userPrompt: AI_USER_PROMPT,
          schema: aiReplySchema,
          schemaHint: AI_SCHEMA_HINT,
          maxTokens: MAX_TOKENS,
          deadlineAt: startedAt + PROVIDER_BUDGET_MS,
          images: [{ mime: "image/jpeg", base64: jpeg.toString("base64") }],
        });
      },
      {
        supabase: gate.supabase,
        userId: gate.userId,
        keyId: parsedKey.data,
        providerName: ready.provider,
        provider,
        key: ready.key,
        model: ready.model,
        logPrefix: "screenshot-ai",
        deadlineAt: startedAt + PROVIDER_BUDGET_MS,
      },
    );
  } catch (err) {
    if (err instanceof StructuredOutputError) {
      // Logged, not returned: the detail quotes the model's reply.
      logError(`[screenshot-ai] ${ready.provider} unusable output:`, err.detail);
      return NextResponse.json(
        {
          error:
            "The AI's answer couldn't be read as trade details, so nothing was filled in. Use the regular reading below, enter the trade by hand, or try another provider.",
        },
        { status: 502 },
      );
    }
    return providerErrorResponse(err, {
      supabase: gate.supabase,
      provider: ready.provider,
      keyId: parsedKey.data,
      logPrefix: "screenshot-ai",
      truncatedHint: "The AI ran out of room before it finished. Try a tighter crop of the screenshot.",
    });
  }

  const result = aiReplyToResult(reply, ready.provider, usedModel);
  result.duplicates = await findPossibleDuplicates(gate.supabase, result).catch(() => []);
  console.info("[screenshot-ai] read", { provider: ready.provider, rows: result.rows.length, ...accuracyLogLine(result) });
  return NextResponse.json(result);
}
