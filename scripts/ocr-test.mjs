// Dev harness for the screenshot-OCR pipeline. Runs the same preprocessing
// and parsing code the browser uses against a folder of test screenshots.
//
//   node scripts/ocr-test.mjs <folder-or-image> [--raw]
//
// --raw skips preprocessing so you can compare accuracy with/without it.
import { readdirSync, statSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import { enhanceForOcr, ocrScaleFor, headerStripHeight } from "../src/lib/ocr/preprocess.ts";
import { parseTradeFromText, findTickerInText } from "../src/lib/ocr/parse-trade.ts";

const target = resolve(process.argv[2] ?? ".");
const skipPreprocess = process.argv.includes("--raw");

const files = statSync(target).isDirectory()
  ? readdirSync(target)
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      .map((f) => join(target, f))
  : [target];

if (files.length === 0) {
  console.error("no images found in", target);
  process.exit(1);
}

const cachePath = join(tmpdir(), "tesseract-cache");
mkdirSync(cachePath, { recursive: true });
const worker = await createWorker("eng", 1, { cachePath });
// Sparse text: broker UIs are scattered labels, not paragraphs
await worker.setParameters({ tessedit_pageseg_mode: "11" });

for (const file of files) {
  let input = file;
  if (!skipPreprocess) {
    const meta = await sharp(file).metadata();
    const scale = ocrScaleFor(meta.width);
    const width = Math.round(meta.width * scale);
    const { data, info } = await sharp(file)
      .resize({ width, kernel: "lanczos3" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    enhanceForOcr({ data: new Uint8ClampedArray(data.buffer), width: info.width, height: info.height });
    input = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png()
      .toBuffer();
  }

  const { data: ocr } = await worker.recognize(input);
  const parsed = parseTradeFromText(ocr.text);

  // Same ticker fallback as run-ocr.ts: single-line pass on the header strip
  let headerText = "";
  if (!parsed.ticker && !skipPreprocess) {
    const meta = await sharp(file).metadata();
    const strip = headerStripHeight(meta.height);
    const scale = Math.max(1, Math.min(5, 2400 / meta.width));
    const { data, info } = await sharp(file)
      .extract({ left: 0, top: 0, width: meta.width, height: strip })
      .resize({ width: Math.round(meta.width * scale), kernel: "lanczos3" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    enhanceForOcr({ data: new Uint8ClampedArray(data.buffer), width: info.width, height: info.height }, true);
    const headerPng = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png()
      .toBuffer();
    await worker.setParameters({ tessedit_pageseg_mode: "6" });
    const { data: headerOcr } = await worker.recognize(headerPng);
    await worker.setParameters({ tessedit_pageseg_mode: "11" });
    headerText = headerOcr.text.trim();
    const ticker = findTickerInText(headerText);
    if (ticker) parsed.ticker = ticker;
  }

  console.log("=".repeat(70));
  console.log(file, skipPreprocess ? "(raw)" : "(preprocessed)");
  console.log("-".repeat(70));
  console.log(ocr.text.trim());
  if (headerText) console.log("HEADER PASS:", JSON.stringify(headerText));
  console.log("-".repeat(70));
  console.log("PARSED:", JSON.stringify(parsed));
}

await worker.terminate();
