import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runOcrPipeline } from "../../src/lib/ocr/pipeline";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

async function dump(rel: string) {
  const buf = await fs.readFile(path.join(ROOT, "fixtures", rel));
  const r = await runOcrPipeline(buf);
  console.log(`\n===== ${rel} =====`);
  console.log("RAW OCR:\n" + r.log.rawText);
  console.log("\nCORE:", JSON.stringify(r.core, null, 2));
  console.log("EXTRA:", JSON.stringify(r.extra));
  console.log("DETECTED LABELS:", r.log.detectedLabels.join(", "));
  console.log("REJECTED:", JSON.stringify(r.log.rejectedFields));
  console.log("VALIDATION:", r.log.validation.map((v) => `${v.ok ? "ok" : "X"} ${v.message}`).join(" | "));
}

async function main() {
  for (const f of process.argv.slice(2)) await dump(f);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
