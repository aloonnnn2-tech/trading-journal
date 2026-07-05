// Primary OCR engine: PaddleOCR PP-OCRv4 via @gutenye/ocr-node, running fully
// offline on ONNX models (no network, no API key). The model session is
// expensive to build, so it is created once and reused across requests (the
// spec's "avoid loading models repeatedly").
//
// Model paths are always resolved by us, from project-root-relative files we
// commit ourselves, rather than left to @gutenye/ocr-node's own default
// resolution (@gutenye/ocr-models/node.js locates its bundled assets via
// `import.meta.url`, a dynamic path serverless bundlers can't always trace --
// confirmed broken on Netlify's Next.js Runtime: the model's own JS gets
// deployed but its .onnx asset files silently don't, so every request 502s
// regardless of Next's own outputFileTracingIncludes config, which Netlify's
// adapter doesn't appear to honor the same way `next build`'s own tracer
// does locally). Plain project-relative files matching this same pattern
// (see the server variant below) are what's actually been verified to work.
//
// Two model variants are supported, both fully offline:
//   - "mobile" (default): small models, committed to models/paddleocr-mobile/
//     (copied once from @gutenye/ocr-models/assets -- see that package's
//     license for redistribution terms). This is the right choice for this
//     app.
//   - "server" (opt-in via OCR_MODEL_VARIANT=server): larger PP-OCRv4 server
//     detection + recognition weights (official PaddleOCR release, converted
//     to ONNX by the RapidOCR project, Apache-2.0), read from
//     models/paddleocr-server/ if present, falling back to mobile otherwise.
//     Measured on scripts/ocr-eval's fixtures (CPU-only onnxruntime-node):
//     15-70x slower per image (up to 157s on a large screenshot — well past
//     this API route's own 60s timeout) for no net accuracy gain over mobile.
//     Left in as an opt-in escape hatch for an operator with GPU-accelerated
//     onnxruntime or a batch/offline use case, not recommended otherwise.

import path from "node:path";
import { promises as fs } from "node:fs";
import type { OcrEngine, OcrLine } from "../types";
import { boxFromPoints, makeLine } from "../types";

interface PaddleLine {
  text?: string;
  mean?: number;
  box?: number[][];
}
interface PaddleOcr {
  detect(imagePath: string, options?: unknown): Promise<PaddleLine[]>;
}
interface ModelPaths {
  detectionPath: string;
  recognitionPath: string;
  dictionaryPath: string;
}

const MOBILE_MODEL_DIR = path.resolve(process.cwd(), "models", "paddleocr-mobile");
const SERVER_MODEL_DIR = path.resolve(process.cwd(), "models", "paddleocr-server");

const MOBILE_MODELS: ModelPaths = {
  detectionPath: path.join(MOBILE_MODEL_DIR, "ch_PP-OCRv4_det_infer.onnx"),
  recognitionPath: path.join(MOBILE_MODEL_DIR, "ch_PP-OCRv4_rec_infer.onnx"),
  dictionaryPath: path.join(MOBILE_MODEL_DIR, "ppocr_keys_v1.txt"),
};

async function resolveModels(): Promise<ModelPaths> {
  if (process.env.OCR_MODEL_VARIANT === "server") {
    const detectionPath = path.join(SERVER_MODEL_DIR, "ch_PP-OCRv4_det_server_infer.onnx");
    const recognitionPath = path.join(SERVER_MODEL_DIR, "ch_PP-OCRv4_rec_server_infer.onnx");
    try {
      await Promise.all([fs.access(detectionPath), fs.access(recognitionPath)]);
      return { detectionPath, recognitionPath, dictionaryPath: MOBILE_MODELS.dictionaryPath };
    } catch {
      // Requested but not downloaded — fall back to the bundled mobile model
      // rather than failing the whole pipeline.
    }
  }
  return MOBILE_MODELS;
}

let ocrPromise: Promise<PaddleOcr> | null = null;

async function getOcr(): Promise<PaddleOcr> {
  if (!ocrPromise) {
    ocrPromise = (async () => {
      const mod = (await import("@gutenye/ocr-node")) as unknown as {
        default: { create(options?: unknown): Promise<PaddleOcr> };
      };
      const models = await resolveModels();
      return mod.default.create({ models });
    })();
    // If model creation fails, allow a later retry rather than caching the error.
    ocrPromise.catch(() => {
      ocrPromise = null;
    });
  }
  return ocrPromise;
}

export const paddleEngine: OcrEngine = {
  name: "paddleocr",
  async recognize(imagePath: string): Promise<OcrLine[]> {
    const ocr = await getOcr();
    const detected = await ocr.detect(imagePath);
    const lines: OcrLine[] = [];
    for (const l of detected) {
      const text = (l.text ?? "").trim();
      if (!text) continue;
      const box =
        Array.isArray(l.box) && l.box.length >= 3
          ? boxFromPoints(l.box)
          : { x0: 0, y0: lines.length * 20, x1: 1000, y1: lines.length * 20 + 18 };
      const confidence = typeof l.mean === "number" ? Math.max(0, Math.min(1, l.mean)) : 0.5;
      lines.push(makeLine(text, confidence, box));
    }
    return lines;
  },
};
