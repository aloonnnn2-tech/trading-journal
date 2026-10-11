// Order-type accuracy on screenshots collected from other sites (broker help
// pages, forums), which stay in the git-ignored scripts/ocr-eval/web-inbox
// because they are someone else's images. Free and deterministic: replays
// what the OCR read (recorded by `npm run ocr:record -- --dir=...`) through
// the reader and scores it against web-inbox/answers.json (null = the text
// can't tell, so nothing may be filled in).
//
//   npm run ocr:record -- --dir=scripts/ocr-eval/web-inbox   # after adding images
//   npm run ocr:web            # score; -v lists every screenshot
//
// The bar is wrongFill 0. Exits 1 otherwise.
import fs from "node:fs";
import path from "node:path";
import { analyseLines } from "../../src/lib/ocr/pipeline";
import { shouldAutofill } from "../../src/lib/ocr/types";

const DIR = path.resolve("scripts/ocr-eval/web-inbox");
const answers = JSON.parse(fs.readFileSync(path.join(DIR, "answers.json"), "utf8")) as Record<string, string | null>;
const verbose = process.argv.includes("-v");

async function main() {
  const tally = { correctFill: 0, correctSuggest: 0, wrongFill: 0, wrongSuggest: 0, missed: 0, rightlyEmpty: 0 };
  for (const [name, want] of Object.entries(answers)) {
    if (name === "_") continue;
    const rec = JSON.parse(fs.readFileSync(path.join(DIR, `${name}.ocr.json`), "utf8"));
    const r = await analyseLines(rec);
    const ot = r.core.order_type;
    const got = ot ? String(ot.value) : null;
    const filled = ot ? shouldAutofill(ot) : false;
    let verdict: keyof typeof tally;
    if (!got) verdict = want ? "missed" : "rightlyEmpty";
    else if (want === got) verdict = filled ? "correctFill" : "correctSuggest";
    else verdict = filled ? "wrongFill" : "wrongSuggest";
    tally[verdict]++;
    if (verbose || verdict === "wrongFill" || verdict === "wrongSuggest" || verdict === "missed")
      console.log(`${verdict.padEnd(14)} ${name.padEnd(30)} want=${want} got=${got}${ot ? ` (${ot.source})` : ""}`);
  }
  console.log(JSON.stringify(tally));
  if (tally.wrongFill > 0) process.exitCode = 1;
}
main().then(() => process.exit(process.exitCode ?? 0));
