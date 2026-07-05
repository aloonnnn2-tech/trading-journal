// Multi-pass OCR runner. Runs the primary engine across every preprocessing
// variant and keeps the highest-scoring result; only if that result is weak
// does it fall back to Tesseract. This is the spec's "multiple OCR passes,
// choose the highest confidence" without wasting passes when one is already
// good.

import type { OcrLine, OcrPassResult } from "../types";
import type { PreprocessVariant } from "../preprocess";
import { paddleEngine } from "./paddle";

/** Char-weighted mean confidence — long confident lines matter more. */
function meanConfidence(lines: OcrLine[]): number {
  let chars = 0;
  let sum = 0;
  for (const l of lines) {
    chars += l.text.length;
    sum += l.confidence * l.text.length;
  }
  return chars === 0 ? 0 : sum / chars;
}

/** Rank a pass by both confidence and how much text it recovered. */
function score(lines: OcrLine[]): number {
  const conf = meanConfidence(lines);
  const coverage = Math.min(1, lines.reduce((n, l) => n + l.text.length, 0) / 120);
  return conf * (0.7 + 0.3 * coverage);
}

function toResult(lines: OcrLine[], engine: string, variant: PreprocessVariant): OcrPassResult {
  return {
    lines,
    engine,
    variant: variant.name,
    variantPath: variant.path,
    meanConfidence: meanConfidence(lines),
    rawText: lines.map((l) => l.text).join("\n"),
  };
}

export async function runOcr(variants: PreprocessVariant[]): Promise<OcrPassResult> {
  let best: OcrPassResult | null = null;
  let bestScore = -1;

  for (const variant of variants) {
    try {
      const lines = await paddleEngine.recognize(variant.path);
      const s = score(lines);
      if (s > bestScore) {
        bestScore = s;
        best = toResult(lines, paddleEngine.name, variant);
      }
      // Good enough — stop spending passes (spec: avoid unnecessary OCR passes).
      // Checked against `best`, not this iteration's `lines` — a later,
      // worse-scoring variant must not end the loop on its own line count
      // while an earlier, better `best` is what's actually kept.
      if (best && best.meanConfidence >= 0.9 && best.lines.length >= 3) break;
    } catch {
      // This variant failed; try the next one. Whether *any* variant threw
      // isn't itself a reason to fall back — `best`'s own quality (checked
      // below) already reflects whether the primary engine produced
      // something usable, regardless of which variant it came from.
    }
  }

  // The Tesseract fallback is intentionally disabled, not just untriggered:
  // tesseract.js's Node backend spawns a worker_thread internally
  // (createWorker()), and a startup failure in that worker is a
  // process-level crash, not a normal thrown error -- it bypasses ordinary
  // try/catch entirely and takes the whole serverless function down.
  // Confirmed via Netlify function logs: "Uncaught Exception ... Cannot
  // find module '..' ... tesseract.js/src/worker-script/node/index.js",
  // caused by Netlify's bundler restructuring tesseract.js's own package
  // layout. Returning Paddle's best-effort result (even low-confidence, or
  // empty) is strictly safer than a fallback attempt that can crash the
  // request outright. Re-enable only after confirming tesseract.js's
  // worker thread actually starts successfully in this deployment target.

  return best ?? { lines: [], engine: "none", variant: "none", variantPath: "", meanConfidence: 0, rawText: "" };
}

export { paddleEngine };
