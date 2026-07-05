// OCR evaluation harness. Runs the offline pipeline over every fixture
// (<name>.png + <name>.expected.json) under fixtures/, scores each extracted
// field against ground truth, and writes a JSON + Markdown report. Metrics:
// per-field accuracy, overall accuracy, precision/recall, false positives,
// confidence calibration, and processing time — the spec's testing framework.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runOcrPipeline } from "../../src/lib/ocr/pipeline";
import { AUTOFILL_CONFIDENCE } from "../../src/lib/ocr/types";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(ROOT, "fixtures");

interface Expected {
  core: Record<string, unknown>;
}
interface FieldReport {
  accuracy: number;
  correct: number;
  wrong: number;
  missing: number;
  avgConfidenceCorrect: number;
  avgConfidenceWrong: number;
}
interface Report {
  generatedAt: string;
  autofillThreshold: number;
  images: number;
  overallAccuracy: number;
  precision: number;
  recall: number;
  falsePositives: number;
  avgProcessingMs: number;
  perField: Record<string, FieldReport>;
  perImage: { name: string; correct: number; total: number; falsePos: number; ms: number; engine: string }[];
}
interface FieldStat {
  correct: number;
  wrong: number;
  missing: number;
  confSumCorrect: number;
  confSumWrong: number;
}

function valuesMatch(expected: unknown, actual: unknown): boolean {
  if (typeof expected === "number" && typeof actual === "number") {
    const denom = Math.max(Math.abs(expected), 1e-9);
    return Math.abs(expected - actual) / denom <= 0.005 || Math.abs(expected - actual) < 0.005;
  }
  return String(expected).trim().toLowerCase() === String(actual).trim().toLowerCase();
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (/\.(png|jpe?g|webp)$/i.test(e.name)) out.push(full);
  }
  return out;
}

async function main() {
  const images = await walk(FIXTURES);
  if (images.length === 0) {
    console.error(`No fixtures found in ${FIXTURES}. Run: npm run ocr:fixtures`);
    process.exit(1);
  }

  const fieldStats = new Map<string, FieldStat>();
  const perImage: {
    name: string;
    correct: number;
    total: number;
    falsePos: number;
    ms: number;
    engine: string;
  }[] = [];
  let totalExpected = 0;
  let totalCorrect = 0;
  let totalDetected = 0;
  let totalFalsePos = 0;
  let totalMs = 0;

  const stat = (k: string): FieldStat => {
    let s = fieldStats.get(k);
    if (!s) {
      s = { correct: 0, wrong: 0, missing: 0, confSumCorrect: 0, confSumWrong: 0 };
      fieldStats.set(k, s);
    }
    return s;
  };

  for (const img of images) {
    const expectedPath = img.replace(/\.(png|jpe?g|webp)$/i, ".expected.json");
    let expected: Expected;
    try {
      expected = JSON.parse(await fs.readFile(expectedPath, "utf8"));
    } catch {
      console.warn(`skip (no ground truth): ${path.relative(FIXTURES, img)}`);
      continue;
    }

    const buffer = await fs.readFile(img);
    const t0 = Date.now();
    const result = await runOcrPipeline(buffer);
    const ms = Date.now() - t0;
    totalMs += ms;

    const expectedCore = expected.core ?? {};
    // A field is "detected" whether it landed in a trade column (core) or was
    // surfaced as an extra (current_price, PnL, ...) — evaluate both.
    const detected = new Map<string, { value: unknown; confidence: number }>();
    for (const [k, v] of Object.entries(result.core)) detected.set(k, { value: v!.value, confidence: v!.confidence });
    for (const e of result.extra) if (!detected.has(e.key)) detected.set(e.key, { value: e.value, confidence: e.confidence });

    let correct = 0;
    let wrong = 0;
    const expKeys = Object.keys(expectedCore);
    totalExpected += expKeys.length;

    for (const key of expKeys) {
      const s = stat(key);
      const det = detected.get(key);
      if (!det) {
        s.missing++;
        continue;
      }
      if (valuesMatch(expectedCore[key], det.value)) {
        s.correct++;
        s.confSumCorrect += det.confidence;
        correct++;
        totalCorrect++;
      } else {
        s.wrong++;
        s.confSumWrong += det.confidence;
        wrong++;
      }
    }

    // False positives: trade-column fields not in ground truth that would
    // actually land in the form — i.e. at or above the auto-fill threshold.
    // A field returned below that threshold is a "detected, low confidence"
    // suggestion the UI shows for the user to opt into (per spec: mark
    // confidence + ask user to confirm rather than blindly filling), so it
    // isn't counted as a false positive here — it never silently corrupts data.
    let falsePos = 0;
    for (const key of Object.keys(result.core)) {
      if (!(key in expectedCore) && result.core[key as keyof typeof result.core]!.confidence >= AUTOFILL_CONFIDENCE) {
        falsePos++;
      }
    }
    totalFalsePos += falsePos;
    totalDetected += correct + wrong + falsePos;

    perImage.push({
      name: path.relative(FIXTURES, img).replace(/\\/g, "/"),
      correct,
      total: expKeys.length,
      falsePos,
      ms,
      engine: result.log.engine,
    });
  }

  const overallAccuracy = totalExpected ? totalCorrect / totalExpected : 0;
  const precision = totalDetected ? totalCorrect / totalDetected : 0;
  const recall = totalExpected ? totalCorrect / totalExpected : 0;
  const avgMs = perImage.length ? Math.round(totalMs / perImage.length) : 0;

  const report: Report = {
    generatedAt: new Date().toISOString(),
    autofillThreshold: AUTOFILL_CONFIDENCE,
    images: perImage.length,
    overallAccuracy: round(overallAccuracy),
    precision: round(precision),
    recall: round(recall),
    falsePositives: totalFalsePos,
    avgProcessingMs: avgMs,
    perField: Object.fromEntries(
      [...fieldStats.entries()].map(([k, s]) => {
        const seen = s.correct + s.wrong + s.missing;
        return [
          k,
          {
            accuracy: round(seen ? s.correct / seen : 0),
            correct: s.correct,
            wrong: s.wrong,
            missing: s.missing,
            avgConfidenceCorrect: round(s.correct ? s.confSumCorrect / s.correct : 0),
            avgConfidenceWrong: round(s.wrong ? s.confSumWrong / s.wrong : 0),
          },
        ];
      }),
    ),
    perImage,
  };

  const jsonPath = path.join(ROOT, "report.json");
  const mdPath = path.join(ROOT, "report.md");
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));
  await fs.writeFile(mdPath, toMarkdown(report));

  console.log(`\nImages:            ${report.images}`);
  console.log(`Overall accuracy:  ${(report.overallAccuracy * 100).toFixed(1)}%`);
  console.log(`Precision:         ${(report.precision * 100).toFixed(1)}%`);
  console.log(`Recall:            ${(report.recall * 100).toFixed(1)}%`);
  console.log(`False positives:   ${report.falsePositives}`);
  console.log(`Avg time:          ${report.avgProcessingMs} ms`);
  console.log(`\nReport: ${path.relative(process.cwd(), mdPath)}`);
}

function round(n: number): number {
  return Number(n.toFixed(3));
}

function toMarkdown(r: Report): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const fieldRows = Object.entries(r.perField)
    .map(
      ([k, s]) =>
        `| ${k} | ${pct(s.accuracy)} | ${s.correct} | ${s.wrong} | ${s.missing} | ${s.avgConfidenceCorrect} | ${s.avgConfidenceWrong} |`,
    )
    .join("\n");
  const imageRows = r.perImage
    .map((i) => `| ${i.name} | ${i.correct}/${i.total} | ${i.falsePos} | ${i.ms} | ${i.engine} |`)
    .join("\n");
  return `# OCR Evaluation Report

Generated: ${r.generatedAt}

- **Images:** ${r.images}
- **Overall accuracy:** ${pct(r.overallAccuracy)}
- **Precision:** ${pct(r.precision)}
- **Recall:** ${pct(r.recall)}
- **False positives:** ${r.falsePositives}
- **Avg processing time:** ${r.avgProcessingMs} ms
- **Auto-fill threshold:** ${r.autofillThreshold}

## Per-field accuracy

| Field | Accuracy | Correct | Wrong | Missing | Avg conf (correct) | Avg conf (wrong) |
|---|---|---|---|---|---|---|
${fieldRows}

## Per-image

| Fixture | Correct | False+ | ms | Engine |
|---|---|---|---|---|
${imageRows}
`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
