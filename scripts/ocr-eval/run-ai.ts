/**
 * Accuracy of "Read with AI" on the same fixtures as the offline reader.
 *
 *   Live (costs a few cents on YOUR key, records the answers):
 *     AI_EVAL_PROVIDER=openai AI_EVAL_KEY=sk-... [AI_EVAL_MODEL=gpt-5-mini] npm run ocr:eval-ai -- --live
 *
 *   Replay (free, deterministic -- what `npm test` does too):
 *     npm run ocr:eval-ai
 *
 * --live sends each fixture image to the provider and saves the model's reply
 * next to it as <name>.ai-<provider>.json. Replay scores those saved replies
 * with the same mapping the app uses (src/lib/ocr/ai-extract.ts), so a change
 * to the mapping or the checks is measured without paying for new answers.
 *
 * The key is read from the environment for this run only and is never
 * written anywhere. Never commit a key; the recordings hold only the model's
 * reading of the (already public) fixture images.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { getProvider } from "../../src/lib/ai-keys/providers";
import { SELECTABLE_PROVIDERS, type AIProviderName } from "../../src/lib/ai-keys/types";
import { generateStructured } from "../../src/lib/ai-reviews/parse";
import {
  AI_SCHEMA_HINT,
  AI_SYSTEM_PROMPT,
  AI_USER_PROMPT,
  aiReplySchema,
  aiReplyToResult,
  SCREENSHOT_AI_PROVIDERS,
  type AiReply,
} from "../../src/lib/ocr/ai-extract";
import { shouldAutofill } from "../../src/lib/ocr/types";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(ROOT, "fixtures");

function matches(expected: unknown, actual: unknown): boolean {
  if (typeof expected === "number" && typeof actual === "number") {
    return Math.abs(expected - actual) <= Math.max(0.005, Math.abs(expected) * 0.005);
  }
  return String(expected).trim().toLowerCase() === String(actual).trim().toLowerCase();
}

async function images(): Promise<string[]> {
  const out: string[] = [];
  for (const dir of await fs.readdir(FIXTURES, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const f of await fs.readdir(path.join(FIXTURES, dir.name))) {
      if (/\.(png|jpe?g|webp)$/i.test(f)) out.push(path.join(FIXTURES, dir.name, f));
    }
  }
  return out;
}

async function main() {
  const live = process.argv.includes("--live");
  const provider = (process.env.AI_EVAL_PROVIDER ?? "") as AIProviderName;
  if (live) {
    if (!(SELECTABLE_PROVIDERS as readonly string[]).includes(provider) || !SCREENSHOT_AI_PROVIDERS.has(provider)) {
      throw new Error(`Set AI_EVAL_PROVIDER to one of: ${[...SCREENSHOT_AI_PROVIDERS].join(", ")}`);
    }
    if (!process.env.AI_EVAL_KEY) throw new Error("Set AI_EVAL_KEY (your own key; it is not stored).");
  }

  let total = 0;
  let correct = 0;
  let wrongFilled = 0;
  let scored = 0;
  const lines: string[] = [];

  for (const img of await images()) {
    const expectedPath = img.replace(/\.(png|jpe?g|webp)$/i, ".expected.json");
    let expected: Record<string, unknown>;
    try {
      expected = JSON.parse(await fs.readFile(expectedPath, "utf8")).core;
    } catch {
      continue;
    }

    const recordings = (await fs.readdir(path.dirname(img))).filter((f) =>
      f.startsWith(path.basename(img).replace(/\.(png|jpe?g|webp)$/i, ".ai-")),
    );
    let reply: AiReply | null = null;
    let used = "";

    if (live) {
      const jpeg = await sharp(await fs.readFile(img))
        .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer();
      const p = getProvider(provider);
      const model = process.env.AI_EVAL_MODEL ?? p.model;
      reply = await generateStructured({
        provider: p,
        apiKey: process.env.AI_EVAL_KEY!,
        model,
        systemPrompt: AI_SYSTEM_PROMPT,
        userPrompt: AI_USER_PROMPT,
        schema: aiReplySchema,
        schemaHint: AI_SCHEMA_HINT,
        maxTokens: 2_500,
        deadlineAt: Date.now() + 60_000,
        images: [{ mime: "image/jpeg", base64: jpeg.toString("base64") }],
      }).catch((e) => {
        console.error(`${path.relative(FIXTURES, img)}: ${e instanceof Error ? e.message : e}`);
        return null;
      });
      used = `${provider}:${model}`;
      if (reply) {
        const out = img.replace(/\.(png|jpe?g|webp)$/i, `.ai-${provider}.json`);
        await fs.writeFile(out, JSON.stringify({ model, reply }, null, 1) + "\n");
      }
    } else if (recordings.length) {
      const rec = JSON.parse(await fs.readFile(path.join(path.dirname(img), recordings[0]), "utf8"));
      reply = aiReplySchema.parse(rec.reply);
      used = `${recordings[0].replace(/^.*\.ai-|\.json$/g, "")}:${rec.model}`;
    } else {
      continue;
    }

    if (!reply) continue;
    scored++;
    const result = aiReplyToResult(reply, provider || "openai", used);
    let c = 0;
    for (const [key, want] of Object.entries(expected)) {
      total++;
      const got = result.core[key as keyof typeof result.core];
      if (got && matches(want, got.value)) {
        c++;
        correct++;
      } else if (got && shouldAutofill(got)) {
        wrongFilled++;
      }
    }
    lines.push(`${path.relative(FIXTURES, img).replace(/\\/g, "/")}: ${c}/${Object.keys(expected).length} (${used})`);
  }

  if (scored === 0) {
    console.log("No recorded AI answers yet. Run with --live and your own key to record some.");
    return;
  }
  console.log(lines.join("\n"));
  console.log(`\nAI accuracy: ${((correct / total) * 100).toFixed(1)}% over ${scored} images; wrong values auto-filled: ${wrongFilled}`);
  if (wrongFilled > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
