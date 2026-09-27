import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guards the homepage's copy against claims the facts rule out.
//
// The file-import claim was flagged in Phase 1B, half-fixed there, and still
// on the page in three places at the end of Phase 2C -- because each fix only
// covered the section in front of it. This test covers every file the
// homepage renders instead, so the next edit anywhere trips it. If it fails,
// the fix is the copy or the facts (docs/design-audit.md, "Facts Alon
// supplies"), not this test.

const LANDING = join(process.cwd(), "src", "components", "landing");

/** Every source file under a directory, tests excluded. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

// The live homepage: everything in v2/ (HomeV2 and its sections), plus the
// shared pieces it imports from one level up and the modal its paid card
// opens. The other files in landing/ are the retired pre-v2 homepage and are
// not rendered.
const FILES = [
  ...walk(join(LANDING, "v2")),
  ...["LandingHeader.tsx", "LandingFooter.tsx", "FeatureGrid.tsx", "PaidPlanModal.tsx"].map((f) => join(LANDING, f)),
];

/** The source with comments removed, so explanatory notes don't count as copy. */
function copyOf(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

/** Lines of copy matching `pattern`, as "file: line" for a readable failure. */
function offending(pattern: RegExp, allow: (line: string) => boolean = () => false): string[] {
  return FILES.flatMap((path) =>
    copyOf(path)
      .split("\n")
      // Code, not copy: imports, JSON.stringify, and the JSON-LD script type.
      .filter((line) => !/^\s*import\s|JSON\.|application\/ld\+json/.test(line))
      .filter((line) => pattern.test(line) && !allow(line))
      .map((line) => `${path.slice(LANDING.length + 1)}: ${line.trim()}`),
  );
}

describe("homepage copy", () => {
  it("covers the files it means to", () => {
    // If this drops, the walk broke and every check below passes vacuously.
    expect(FILES.length).toBeGreaterThan(15);
    expect(FILES.some((f) => f.endsWith("FeatureTour.tsx"))).toBe(true);
    expect(FILES.some((f) => f.endsWith("Hero.tsx"))).toBe(true);
  });

  it("never claims CSV or JSON import (not a confirmed path)", () => {
    expect(offending(/\b(csv|json)\b/i)).toEqual([]);
  });

  it("names Excel / XLSX only as an export format", () => {
    expect(offending(/\b(excel|xlsx)\b/i, (line) => /export/i.test(line))).toEqual([]);
  });

  it("never claims 'nothing is a teaser' beside cards marked PAID", () => {
    // The spec's line for What's included. False next to the PAID cards in the
    // same grid; 3A ships "Everything marked FREE is in the free plan today".
    expect(offending(/nothing (above|here) is a teaser/i)).toEqual([]);
  });

  it("never says the hero preview's figures come from the demo account", () => {
    // They're hand-drawn illustration, older than the demo account; the
    // caption says "Sample figures". Scoped to the hero's own files: Find My
    // Edge's caption says the same words and is TRUE -- that screenshot is
    // the demo account.
    const hero = ["Hero.tsx", "HeroPanel.tsx", "FloatingCards.tsx"].map((f) => join(LANDING, "v2", f));
    for (const path of hero) expect(copyOf(path)).not.toMatch(/demo account/i);
  });

  it("never overstates edit history (each trade keeps its newest 50 versions)", () => {
    expect(offending(/every edit|full version history|history in (?:takes )?one sitting/i)).toEqual([]);
  });
});
