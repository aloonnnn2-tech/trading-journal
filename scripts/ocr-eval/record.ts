/**
 * Records what the OCR engine reads from each fixture image, next to it as
 * <name>.ocr.json, so src/lib/ocr/regression.test.ts can replay the reading
 * rules in `npm test` without running the OCR engine (deterministic, fast).
 *
 *   npm run ocr:record
 *
 * Re-run after adding a fixture or changing the OCR engine / preprocessing.
 * Changing only the reading rules (labels, semantic, validate, resolve) needs
 * no re-record -- that is exactly what the replay test checks.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { preprocessImage } from "../../src/lib/ocr/preprocess";
import { runOcr } from "../../src/lib/ocr/engines";
import { ocrRoi } from "../../src/lib/ocr/roi";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(ROOT, "fixtures");

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (/\.(png|jpe?g|webp)$/i.test(e.name)) out.push(full);
  }
  return out;
}

async function main() {
  const images = await walk(FIXTURES);
  let n = 0;
  for (const img of images) {
    const expected = img.replace(/\.(png|jpe?g|webp)$/i, ".expected.json");
    try {
      await fs.access(expected);
    } catch {
      continue; // no ground truth, nothing to replay against
    }
    const pre = await preprocessImage(await fs.readFile(img));
    try {
      const pass = await runOcr(pre.variants);
      const roiLines = await ocrRoi(pass.variantPath, pass.lines).catch(() => []);
      const out = img.replace(/\.(png|jpe?g|webp)$/i, ".ocr.json");
      await fs.writeFile(out, JSON.stringify({ lines: pass.lines, roiLines, rawText: pass.rawText }, null, 1) + "\n");
      n++;
      console.log("recorded", path.relative(FIXTURES, out));
    } finally {
      await pre.cleanup();
    }
  }
  console.log(`\n${n} fixtures recorded.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
