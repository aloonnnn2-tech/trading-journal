import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyseLines } from "./pipeline";
import { shouldAutofill, type OcrLine } from "./types";

// The screenshot reader's accuracy, in `npm test` (Problem 2 of the
// hardening brief). Replays what the OCR engine read from each fixture image
// (recorded by `npm run ocr:record`) through the reading rules, and checks
// every expected value. Deterministic and fast: no OCR engine, no network.
// The pixel-based greyed-out check needs the image, so it only runs in the
// live eval (`npm run ocr:eval`).
//
// Two guarantees:
//   1. NO WRONG VALUE IS EVER AUTO-FILLED. No exceptions.
//   2. Every expected value is read (filled or suggested), except the
//      KNOWN_GAPS below, each with its reason. Fix one, and the test tells
//      you to remove it from the list.

const FIXTURES = path.resolve(__dirname, "../../../scripts/ocr-eval/fixtures");

const KNOWN_GAPS: Record<string, string> = {
  "stocks/Trading_overview_stocks_(Dark_theme):entry_price":
    "a hover tooltip '@ 273.13' is read instead of the order's 278.00; offered only as a suggestion",
  "new-broker/order-usb-stop:order_type": "the ticket shows the type only as a highlighted tab, which text can't see",
  "options/webull-options-tpsl:time_in_force": "'Time-in-Force Day' is split across lines the label matcher misses",
};

interface Recorded {
  lines: OcrLine[];
  roiLines: OcrLine[];
  rawText: string;
}

function fixtures(): { name: string; recorded: Recorded; expected: Record<string, unknown> }[] {
  const out = [];
  for (const dir of fs.readdirSync(FIXTURES)) {
    const full = path.join(FIXTURES, dir);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const file of fs.readdirSync(full)) {
      if (!file.endsWith(".ocr.json")) continue;
      const base = file.slice(0, -".ocr.json".length);
      const expectedPath = path.join(full, `${base}.expected.json`);
      if (!fs.existsSync(expectedPath)) continue;
      out.push({
        name: `${dir}/${base}`,
        recorded: JSON.parse(fs.readFileSync(path.join(full, file), "utf8")) as Recorded,
        expected: (JSON.parse(fs.readFileSync(expectedPath, "utf8")) as { core: Record<string, unknown> }).core,
      });
    }
  }
  return out;
}

function matches(expected: unknown, actual: unknown): boolean {
  if (typeof expected === "number" && typeof actual === "number") {
    return Math.abs(expected - actual) <= Math.max(0.005, Math.abs(expected) * 0.005);
  }
  return String(expected).trim().toLowerCase() === String(actual).trim().toLowerCase();
}

const all = fixtures();

describe("screenshot reader regression (recorded OCR)", () => {
  it("has recorded fixtures to replay (run `npm run ocr:record` after adding one)", () => {
    expect(all.length).toBeGreaterThanOrEqual(15);
  });

  it.each(all.map((f) => [f.name, f] as const))("%s", async (_name, fx) => {
    const r = await analyseLines(fx.recorded);
    const problems: string[] = [];
    const stale: string[] = [];

    for (const [key, want] of Object.entries(fx.expected)) {
      const core = r.core[key as keyof typeof r.core];
      const extra = r.extra.find((e) => e.key === key);
      const got = core?.value ?? extra?.value;
      const id = `${fx.name}:${key}`;

      // 1. Never a wrong value typed into the form.
      if (core && shouldAutofill(core) && !matches(want, core.value)) {
        problems.push(`${key}: AUTO-FILLED WRONG value ${String(core.value)} (expected ${String(want)})`);
        continue;
      }
      // 2. Read, one way or another.
      const ok = got !== undefined && matches(want, got);
      if (!ok && !KNOWN_GAPS[id]) problems.push(`${key}: got ${got === undefined ? "nothing" : String(got)}, expected ${String(want)}`);
      if (ok && KNOWN_GAPS[id]) stale.push(id);
    }

    expect(problems, "reading regression").toEqual([]);
    expect(stale, "fixed! remove these from KNOWN_GAPS").toEqual([]);
  });
});
