import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { METRICS, findMetric } from "./catalog";

describe("the metric catalog", () => {
  it("explains every entry fully: definition, how to read it, caveats, where it is, a source", () => {
    const ids = new Set<string>();
    for (const m of METRICS) {
      expect(ids.has(m.id), `duplicate id ${m.id}`).toBe(false);
      ids.add(m.id);
      expect(m.name.trim().length, `${m.id}.name`).toBeGreaterThan(1);
      for (const field of ["where", "definition", "howToRead", "caveats"] as const) {
        expect(m[field].trim().length, `${m.id}.${field}`).toBeGreaterThan(10);
      }
      expect(m.source.kind, m.id).toBeTruthy();
    }
  });

  it("labels rules of thumb as rules of thumb, never as facts about the trader", () => {
    for (const m of METRICS) {
      // A threshold in the guidance must say it is a convention.
      if (/\d+(\.\d+)?\s*(%|R\b)/.test(m.howToRead) && /solid|excellent|upper limit|minimum|keep .* under/i.test(m.howToRead)) {
        expect(m.howToRead, m.id).toMatch(/commonly|rule of thumb|cited/i);
      }
    }
  });
});

describe("findMetric", () => {
  it("finds a metric by id, name or what people call it", () => {
    expect(findMetric("mae")?.id).toBe("mae");
    expect(findMetric("Max adverse excursion")?.id).toBe("mae");
    expect(findMetric("MFE")?.id).toBe("mfe");
    expect(findMetric("profit factor")?.id).toBe("profit_factor");
    expect(findMetric("PF")?.id).toBe("profit_factor");
    expect(findMetric("expectancy")?.id).toBe("expectancy");
    expect(findMetric("R:R")?.id).toBe("risk_reward");
  });

  it("finds it inside a longer question too", () => {
    expect(findMetric("what's my mae")?.id).toBe("mae");
    expect(findMetric("is my win rate good")?.id).toBe("win_rate");
  });

  it("prefers the exact section name over a word inside it", () => {
    expect(findMetric("Win rate by direction and tag")?.id).toBe("by_direction");
  });

  it("returns null for something that isn't a metric", () => {
    expect(findMetric("banana bread")).toBeNull();
    expect(findMetric("   ")).toBeNull();
  });
});

// ---- Drift guard ------------------------------------------------------------
//
// Every figure the app shows on these surfaces must be one Ask can explain.
// A new stat card without a catalog entry fails here, so "explain anything in
// my journal" stays true as the app grows.

const ROOT = path.join(__dirname, "..", "..", "..", "..");
const SURFACES = [
  "src/app/analytics/page.tsx",
  "src/app/dashboard/page.tsx",
  "src/app/analytics/excursion-panel.tsx",
  "src/lib/trades/summary-strip.ts",
];
/** Labels on those surfaces that are not figures to explain. */
const NOT_METRICS = new Set(["With a stop"]);

function labelsIn(file: string): string[] {
  const text = fs.readFileSync(path.join(ROOT, file), "utf8");
  return [...text.matchAll(/label(?:=|: )"([^"]+)"/g)].map((m) => m[1]);
}

describe("every figure on the app's metric surfaces has an explanation", () => {
  for (const file of SURFACES) {
    it(file, () => {
      const labels = labelsIn(file).filter((l) => !NOT_METRICS.has(l));
      expect(labels.length, `no labels found in ${file} -- has the markup changed?`).toBeGreaterThan(3);
      const missing = labels.filter((l) => findMetric(l) === null);
      expect(missing, `add these to src/lib/ai-keys/metrics/catalog.ts`).toEqual([]);
    });
  }
});
