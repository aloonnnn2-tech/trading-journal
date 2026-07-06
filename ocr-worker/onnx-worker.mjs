// Runs PaddleOCR detection in its own OS process.
//
// Why this exists: onnxruntime-node's native addon needs LD_LIBRARY_PATH to
// point at a directory holding libonnxruntime.so.1 (see
// src/lib/ocr/engines/paddle.ts for the full story -- the file is too big to
// ship raw in the deployed function, so a compressed copy is decompressed
// into /tmp on cold start instead). LD_LIBRARY_PATH is only consulted by the
// dynamic linker once, when a process starts; setting it on the
// already-running Next.js server process (even as a genuine env var, not
// just a JS-side mutation -- confirmed via Netlify function logs) has no
// effect on dlopen() resolution for that process. Spawning this file as a
// fresh child process, with LD_LIBRARY_PATH set in *its* env at spawn time,
// gives the dynamic linker a process that actually starts with the right
// search path.
//
// Talks to the parent over the IPC channel child_process.fork() sets up:
// receives {type:"detect", id, imagePath}, replies
// {type:"result", id, ok, lines|error}.

import path from "node:path";
import { promises as fs } from "node:fs";

const MOBILE_MODEL_DIR = path.resolve(process.cwd(), "models", "paddleocr-mobile");
const SERVER_MODEL_DIR = path.resolve(process.cwd(), "models", "paddleocr-server");

const MOBILE_MODELS = {
  detectionPath: path.join(MOBILE_MODEL_DIR, "ch_PP-OCRv4_det_infer.onnx"),
  recognitionPath: path.join(MOBILE_MODEL_DIR, "ch_PP-OCRv4_rec_infer.onnx"),
  dictionaryPath: path.join(MOBILE_MODEL_DIR, "ppocr_keys_v1.txt"),
};

async function resolveModels() {
  if (process.env.OCR_MODEL_VARIANT === "server") {
    const detectionPath = path.join(SERVER_MODEL_DIR, "ch_PP-OCRv4_det_server_infer.onnx");
    const recognitionPath = path.join(SERVER_MODEL_DIR, "ch_PP-OCRv4_rec_server_infer.onnx");
    try {
      await Promise.all([fs.access(detectionPath), fs.access(recognitionPath)]);
      return { detectionPath, recognitionPath, dictionaryPath: MOBILE_MODELS.dictionaryPath };
    } catch {
      // Requested but not downloaded -- fall back to mobile.
    }
  }
  return MOBILE_MODELS;
}

async function main() {
  const models = await resolveModels();
  const exists = await Promise.all(
    Object.entries(models).map(async ([key, p]) => {
      const ok = await fs
        .access(p)
        .then(() => true)
        .catch(() => false);
      return `${key}=${p} exists=${ok}`;
    }),
  );
  console.error(`[ocr-worker] cwd=${process.cwd()} model paths: ${exists.join(" | ")}`);
  const mod = await import("@gutenye/ocr-node");
  const ocr = await mod.default.create({ models });
  console.error("[ocr-worker] paddle engine created successfully");

  process.on("message", async (msg) => {
    if (!msg || msg.type !== "detect") return;
    try {
      const lines = await ocr.detect(msg.imagePath);
      process.send({ type: "result", id: msg.id, ok: true, lines });
    } catch (err) {
      process.send({
        type: "result",
        id: msg.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  process.send({ type: "ready" });
}

main().catch((err) => {
  process.send({ type: "init-error", error: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
});
