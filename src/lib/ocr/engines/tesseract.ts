// Fallback OCR engine: Tesseract.js running in Node.
//
// NOT CURRENTLY WIRED UP. `engines/index.ts` deliberately never imports
// `tesseractEngine` -- tesseract.js's Node backend spawns a worker_thread
// internally, and a startup failure in that worker is a process-level crash
// that bypasses ordinary try/catch, which took down a Netlify function in
// production (see the comment in index.ts for the confirmed stack trace).
// This file is kept, working, and ready to wire back in once that's fixed;
// it isn't dead code by accident, so don't delete it as unused without
// reading that comment first.
//
// Line-level boxes are extracted when Tesseract provides them; if a build
// only yields flat text, lines fall back to stacked synthetic boxes so the
// semantic parser still gets usable line text. Worker creation is cached.

import type { OcrEngine, OcrLine } from "../types";
import { makeLine } from "../types";

interface TessBBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface TessLine {
  text: string;
  confidence: number;
  bbox: TessBBox;
}
interface TessWorker {
  recognize(image: string, opts?: unknown, output?: unknown): Promise<{ data: TessData }>;
  terminate(): Promise<unknown>;
}
interface TessData {
  text: string;
  lines?: TessLine[];
  blocks?: { paragraphs?: { lines?: TessLine[] }[] }[] | null;
}

let workerPromise: Promise<TessWorker> | null = null;

async function getWorker(): Promise<TessWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const os = await import("node:os");
      const { createWorker } = (await import("tesseract.js")) as unknown as {
        createWorker(lang: string, oem?: number, opts?: unknown): Promise<TessWorker>;
      };
      // Tesseract's default cachePath is the process cwd, which is
      // read-only on serverless platforms like Netlify Functions -- the
      // cache write fails silently there and every cold start re-fetches
      // the language model from jsdelivr instead. os.tmpdir() is writable
      // in those environments.
      return createWorker("eng", undefined, { cachePath: os.tmpdir() });
    })();
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

function collectLines(data: TessData): TessLine[] {
  if (data.lines?.length) return data.lines;
  const out: TessLine[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) out.push(line);
    }
  }
  return out;
}

export const tesseractEngine: OcrEngine = {
  name: "tesseract",
  async recognize(imagePath: string): Promise<OcrLine[]> {
    const worker = await getWorker();
    const { data } = await worker.recognize(imagePath, {}, { text: true, blocks: true });
    const tessLines = collectLines(data);

    if (tessLines.length) {
      return tessLines
        .map((l) => makeLine((l.text ?? "").trim(), Math.max(0, Math.min(1, (l.confidence ?? 0) / 100)), l.bbox))
        .filter((l) => l.text.length > 0);
    }

    // No structured lines — fall back to flat text with stacked boxes.
    return (data.text ?? "")
      .split(/\r?\n/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t, i) => makeLine(t, 0.4, { x0: 0, y0: i * 20, x1: 1000, y1: i * 20 + 18 }));
  },
};
