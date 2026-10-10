import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FREE_FEATURES, PAID_FEATURES, PAID_GROUPS } from "./paid-features";
import { WAITLIST_SOURCES } from "@/lib/waitlist/constants";

const SRC = path.resolve(__dirname, "../..");

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return files(full);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

describe("the paid-plan list", () => {
  it("has one entry per feature, each with a unique id", () => {
    const ids = PAID_FEATURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PAID_FEATURES.length).toBe(PAID_GROUPS.reduce((n, g) => n + g.features.length, 0));
  });

  it("names no price: billing is not live, so nothing may look buyable", () => {
    const text = JSON.stringify({ PAID_GROUPS, FREE_FEATURES });
    expect(text).not.toMatch(/[$€£]\s?\d|\d+\s?(usd|eur)|per month|\/mo\b|per year|\/yr\b/i);
  });

  it("is the one list the /paid-plan page reads", () => {
    const page = fs.readFileSync(path.join(SRC, "app/paid-plan/page.tsx"), "utf8");
    expect(page).toMatch(/PAID_GROUPS\.map/);
    expect(page).not.toMatch(/const GROUPS\b/);
  });
});

describe("See plans inside the app", () => {
  it("never links to the homepage's pricing section, which redirects a signed-in user away", () => {
    const offenders = files(SRC)
      .filter((f) => !f.includes(`${path.sep}components${path.sep}landing${path.sep}`))
      .filter((f) => !f.endsWith("PlansPanel.tsx"))
      .filter((f) => /href=["'{`]*\/#pricing/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it("records waitlist joins from the panel under their own source", () => {
    expect(WAITLIST_SOURCES).toContain("app-plans-panel");
  });
});
