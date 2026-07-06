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
//
// onnxruntime-node's native addon (onnxruntime_binding.node) dlopen's a
// sibling shared library, libonnxruntime.so.1 (~36MB), from the OS dynamic
// linker rather than a JS require() -- invisible to Next's/Netlify's file
// tracer, which silently drops it from the deployed function (confirmed via
// Netlify function logs: "libonnxruntime.so.1: cannot open shared object
// file"). Explicitly force-including the raw file fixes that but then blows
// past AWS Lambda's 50MB *zipped* function-package limit (confirmed: deploy
// failed with "request body too large" once the 36MB .so was added on top of
// the existing ~30MB bundle). Fix: commit a gzip-compressed copy instead
// (models/onnxruntime-node-linux-x64/libonnxruntime.so.1.gz, ~14MB, well
// within budget) and decompress it into /tmp -- the only writable path in a
// Lambda -- on cold start. The addon's own require() path (baked at build
// time as `$ORIGIN`-relative) can't be redirected to /tmp from JS, so
// LD_LIBRARY_PATH must point there instead; critically, that only works if
// it's set as a real Lambda environment variable *before* the process starts
// (see netlify.toml) -- mutating process.env from Node code has no effect on
// the dynamic linker's already-initialized search path.

import path from "node:path";
import { promises as fs } from "node:fs";
import zlib from "node:zlib";
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

const COMPRESSED_SHARED_LIB_PATH = path.resolve(
  process.cwd(),
  "models",
  "onnxruntime-node-linux-x64",
  "libonnxruntime.so.1.gz",
);
const NODE_MODULES_SHARED_LIB_PATH = path.resolve(
  process.cwd(),
  "node_modules",
  "onnxruntime-node",
  "bin",
  "napi-v6",
  "linux",
  "x64",
  "libonnxruntime.so.1",
);
const TMP_LIB_DIR = "/tmp/onnxruntime-lib";
const TMP_SHARED_LIB_PATH = path.join(TMP_LIB_DIR, "libonnxruntime.so.1");

async function pathExists(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

/**
 * Deployed functions ship a gzipped copy of libonnxruntime.so.1 instead of
 * the raw file (see the file-level comment for why) -- decompress it into
 * /tmp once per cold start so the dynamic linker can find it there via
 * LD_LIBRARY_PATH. A no-op wherever the full node_modules install already
 * has the raw .so (local dev, or a warm container that's already extracted
 * it).
 */
async function ensureOnnxRuntimeSharedLibrary(): Promise<void> {
  if (process.platform !== "linux") return;
  if (await pathExists(NODE_MODULES_SHARED_LIB_PATH)) return;
  if (await pathExists(TMP_SHARED_LIB_PATH)) return;
  const compressed = await fs.readFile(COMPRESSED_SHARED_LIB_PATH);
  const decompressed = zlib.gunzipSync(compressed);
  await fs.mkdir(TMP_LIB_DIR, { recursive: true });
  await fs.writeFile(TMP_SHARED_LIB_PATH, decompressed);
  console.error(
    `[ocr] extracted libonnxruntime.so.1 (${decompressed.length} bytes) to ${TMP_SHARED_LIB_PATH}, LD_LIBRARY_PATH=${process.env.LD_LIBRARY_PATH ?? "(unset)"}`,
  );
}

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
      await ensureOnnxRuntimeSharedLibrary();
      const models = await resolveModels();
      // Cold-start-only diagnostic (this whole IIFE runs once and is cached in
      // ocrPromise) — cheap enough to always log, and the one thing that
      // actually explains a silent "engine: none" result in a deployed
      // environment where local paths that resolve fine in dev may not exist.
      const exists = await Promise.all(
        Object.entries(models).map(async ([key, p]) => {
          const ok = await fs
            .access(p)
            .then(() => true)
            .catch(() => false);
          return `${key}=${p} exists=${ok}`;
        }),
      );
      console.error(`[ocr] cwd=${process.cwd()} model paths: ${exists.join(" | ")}`);
      const mod = (await import("@gutenye/ocr-node")) as unknown as {
        default: { create(options?: unknown): Promise<PaddleOcr> };
      };
      return mod.default.create({ models });
    })();
    // If model creation fails, allow a later retry rather than caching the error.
    ocrPromise.catch((err) => {
      console.error("[ocr] model creation failed:", err);
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
