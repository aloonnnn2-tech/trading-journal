// Primary OCR engine: PaddleOCR PP-OCRv4 via @gutenye/ocr-node, running fully
// offline on ONNX models (no network, no API key).
//
// Runs in a dedicated child process (ocr-worker/onnx-worker.mjs), spawned
// once and reused across requests -- not for isolation, but because
// onnxruntime-node's native addon needs LD_LIBRARY_PATH to point at a
// directory holding libonnxruntime.so.1, and LD_LIBRARY_PATH is only
// consulted by the dynamic linker once, when a process starts. The raw .so
// is too big to ship in the deployed function (see below), so a compressed
// copy is decompressed into /tmp on cold start instead -- but setting
// LD_LIBRARY_PATH on the already-running Next.js server process, even as a
// genuine Lambda environment variable (confirmed via Netlify function logs,
// not just a JS-side process.env mutation), has no effect on dlopen()
// resolution for that already-started process. Spawning a fresh child with
// LD_LIBRARY_PATH set in *its* env at spawn time is the only thing that
// actually works. The model session is still expensive to build, so the
// worker (and its loaded model) is kept alive and reused across requests,
// same as when this was in-process (the spec's "avoid loading models
// repeatedly").
//
// Model paths are always resolved by the worker, from project-root-relative
// files committed ourselves, rather than left to @gutenye/ocr-node's own
// default resolution (@gutenye/ocr-models/node.js locates its bundled assets
// via `import.meta.url`, a dynamic path serverless bundlers can't always
// trace -- confirmed broken on Netlify's Next.js Runtime: the model's own JS
// gets deployed but its .onnx asset files silently don't, so every request
// 502s regardless of Next's own outputFileTracingIncludes config, which
// Netlify's adapter doesn't appear to honor the same way `next build`'s own
// tracer does locally). Plain project-relative files matching this same
// pattern (see the server variant in ocr-worker/onnx-worker.mjs) are what's
// actually been verified to work.
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
// onnxruntime-node's native addon (onnxruntime_binding.node) dlopen's
// libonnxruntime.so.1 (~36MB) from the OS dynamic linker rather than a JS
// require() -- invisible to Next's/Netlify's file tracer, which silently
// drops it from the deployed function (confirmed via Netlify function logs:
// "libonnxruntime.so.1: cannot open shared object file"). Explicitly
// force-including the raw file fixes that but then blows past AWS Lambda's
// 50MB *zipped* function-package limit (confirmed: deploy failed with
// "request body too large" once the 36MB .so was added on top of the
// existing ~30MB bundle). Fix: commit a gzip-compressed copy instead
// (models/onnxruntime-node-linux-x64/libonnxruntime.so.1.gz, ~14MB, well
// within budget) and decompress it into /tmp -- the only writable path in a
// Lambda -- on cold start, then point the worker's LD_LIBRARY_PATH there.

import path from "node:path";
import { promises as fs } from "node:fs";
import zlib from "node:zlib";
import { spawn, type ChildProcess } from "node:child_process";
import type { OcrEngine, OcrLine } from "../types";
import { boxFromPoints, makeLine } from "../types";

// Never called -- ocr-worker/onnx-worker.mjs does its own import() of this
// package at runtime. This reference exists purely so Next's file tracer
// walks @gutenye/ocr-node's module graph and follows it into its
// transitive native dependencies (onnxruntime-node, @techstark/opencv-js,
// js-clipper, onnxruntime-common), the same way it did when this file
// actually imported the package in-process. outputFileTracingIncludes only
// force-copies literal globs, it doesn't re-run dependency tracing on what
// it copies -- confirmed via Netlify function logs: with only a glob
// include for @gutenye/ocr-node/**, the worker's own dependencies
// (opencv-js etc.) were silently absent from the deployed bundle even
// though @gutenye/ocr-node's own files were present.
async function _tracingOnly() {
  await import("@gutenye/ocr-node");
}
void _tracingOnly;

interface PaddleLine {
  text?: string;
  mean?: number;
  box?: number[][];
}

type WorkerMessage =
  | { type: "ready" }
  | { type: "init-error"; error: string }
  | { type: "result"; id: string; ok: true; lines: PaddleLine[] }
  | { type: "result"; id: string; ok: false; error: string };

const WORKER_SCRIPT_PATH = path.resolve(process.cwd(), "ocr-worker", "onnx-worker.mjs");

// Mirrors the model paths ocr-worker/onnx-worker.mjs actually reads.
// Nothing in this file touches them directly anymore (the worker does its
// own fs reads), but Next's file tracer only follows fs.access/fs.readFile
// calls it can see in the traced module graph -- without a reference here
// these silently drop out of the deployed bundle the same way the worker
// script itself did (see spawnWorker's own existence check below).
const MOBILE_MODEL_DIR = path.resolve(process.cwd(), "models", "paddleocr-mobile");
const MOBILE_MODEL_PATHS = [
  path.join(MOBILE_MODEL_DIR, "ch_PP-OCRv4_det_infer.onnx"),
  path.join(MOBILE_MODEL_DIR, "ch_PP-OCRv4_rec_infer.onnx"),
  path.join(MOBILE_MODEL_DIR, "ppocr_keys_v1.txt"),
];

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
 * /tmp once per cold start so the worker's LD_LIBRARY_PATH can point at it.
 * A no-op wherever the full node_modules install already has the raw .so
 * (local dev, or a warm container that's already extracted it).
 */
async function ensureOnnxRuntimeSharedLibrary(): Promise<void> {
  if (process.platform !== "linux") return;
  if (await pathExists(NODE_MODULES_SHARED_LIB_PATH)) return;
  if (await pathExists(TMP_SHARED_LIB_PATH)) return;
  const compressed = await fs.readFile(COMPRESSED_SHARED_LIB_PATH);
  const decompressed = zlib.gunzipSync(compressed);
  await fs.mkdir(TMP_LIB_DIR, { recursive: true });
  await fs.writeFile(TMP_SHARED_LIB_PATH, decompressed);
  console.error(`[ocr] extracted libonnxruntime.so.1 (${decompressed.length} bytes) to ${TMP_SHARED_LIB_PATH}`);
}

interface PendingRequest {
  resolve: (lines: PaddleLine[]) => void;
  reject: (err: Error) => void;
}

interface Worker {
  child: ChildProcess;
  pending: Map<string, PendingRequest>;
}

let currentWorker: Worker | null = null;
let workerPromise: Promise<Worker> | null = null;
let nextRequestId = 0;

function failWorker(worker: Worker, err: Error) {
  if (currentWorker === worker) currentWorker = null;
  workerPromise = null;
  for (const req of worker.pending.values()) req.reject(err);
  worker.pending.clear();
}

async function spawnWorker(): Promise<Worker> {
  await ensureOnnxRuntimeSharedLibrary();
  // fork() only ever sees WORKER_SCRIPT_PATH as a runtime string, not a
  // require()/import()/fs.readFile() call -- Next's file tracer doesn't
  // treat that as a reference to bundle, unlike the models/ files (read via
  // fs.access/fs.readFile with a resolvable literal path, which the tracer
  // *does* follow). This access() call is what actually gets the worker
  // script included in the deployed function; it also confirms as much in
  // the logs instead of failing with an opaque MODULE_NOT_FOUND.
  const workerScriptExists = await pathExists(WORKER_SCRIPT_PATH);
  const modelsExist = await Promise.all(MOBILE_MODEL_PATHS.map((p) => pathExists(p)));
  console.error(
    `[ocr] onnx worker script ${WORKER_SCRIPT_PATH} exists=${workerScriptExists}; models exist=${modelsExist.join(",")}`,
  );
  return new Promise((resolve, reject) => {
    // spawn(), not fork(): Turbopack special-cases fork()'s first argument
    // and tries to statically resolve it as a module import at build time,
    // hard-failing the build since WORKER_SCRIPT_PATH is a runtime-computed
    // path, not a literal it can trace. spawn() with process.execPath is
    // exactly what fork() does under the hood minus that special-casing --
    // same IPC channel semantics via the explicit "ipc" stdio entry.
    const child = spawn(process.execPath, [WORKER_SCRIPT_PATH], {
      // Only meaningful on Linux (see file-level comment); harmless
      // elsewhere since TMP_LIB_DIR won't exist and gets silently skipped.
      env: { ...process.env, LD_LIBRARY_PATH: TMP_LIB_DIR },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    const worker: Worker = { child, pending: new Map() };
    let ready = false;

    child.on("message", (msg: WorkerMessage) => {
      if (!msg) return;
      if (msg.type === "ready") {
        ready = true;
        console.error("[ocr] onnx worker ready");
        resolve(worker);
        return;
      }
      if (msg.type === "init-error") {
        reject(new Error(`onnx worker failed to initialize: ${msg.error}`));
        return;
      }
      if (msg.type === "result") {
        const req = worker.pending.get(msg.id);
        if (!req) return;
        worker.pending.delete(msg.id);
        if (msg.ok) req.resolve(msg.lines);
        else req.reject(new Error(msg.error));
      }
    });

    child.on("error", (err) => {
      if (!ready) reject(err);
      failWorker(worker, err);
    });

    child.on("exit", (code) => {
      const err = new Error(`onnx worker exited unexpectedly (code ${code})`);
      if (!ready) reject(err);
      failWorker(worker, err);
    });
  });
}

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = spawnWorker().then((worker) => {
      currentWorker = worker;
      return worker;
    });
    workerPromise.catch((err) => {
      console.error("[ocr] onnx worker failed to start:", err);
      workerPromise = null;
    });
  }
  return workerPromise;
}

const DETECT_TIMEOUT_MS = 20_000;

function detect(worker: Worker, imagePath: string): Promise<PaddleLine[]> {
  return new Promise((resolve, reject) => {
    const id = String(nextRequestId++);
    const timeout = setTimeout(() => {
      worker.pending.delete(id);
      reject(new Error("onnx worker timed out"));
    }, DETECT_TIMEOUT_MS);
    worker.pending.set(id, {
      resolve: (lines) => {
        clearTimeout(timeout);
        resolve(lines);
      },
      reject: (err) => {
        clearTimeout(timeout);
        reject(err);
      },
    });
    worker.child.send({ type: "detect", id, imagePath });
  });
}

export const paddleEngine: OcrEngine = {
  name: "paddleocr",
  async recognize(imagePath: string): Promise<OcrLine[]> {
    const worker = await getWorker();
    const detected = await detect(worker, imagePath);
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
