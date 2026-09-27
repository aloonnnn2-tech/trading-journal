import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOUR_TABS } from "@/components/landing/v2/tour-content";

// Holds the tour's FREE/PAID badges to the app's real gates. If a gate moves,
// this fails: fix the badge (or the gate), not the test.

const src = (...parts: string[]) => readFileSync(join(process.cwd(), "src", ...parts), "utf8");

describe("feature tour content", () => {
  it("has the spec's five tabs, in order", () => {
    expect(TOUR_TABS.map((t) => t.label)).toEqual([
      "Rules & mistakes",
      "MAE/MFE",
      "Find my edge",
      "Import",
      "AI review",
    ]);
  });

  it("gives every tab three bullets and a unique id", () => {
    for (const tab of TOUR_TABS) expect(tab.bullets).toHaveLength(3);
    expect(new Set(TOUR_TABS.map((t) => t.id)).size).toBe(TOUR_TABS.length);
  });

  it("marks exactly MAE/MFE, Find my edge and AI review as paid", () => {
    expect(TOUR_TABS.filter((t) => t.paid).map((t) => t.label)).toEqual(["MAE/MFE", "Find my edge", "AI review"]);
  });

  it("matches the gates in the app", () => {
    // PAID: MAE/MFE and the AI trade review are refused to free users...
    // (Matched as a call, `await requirePaidUser()`: the strategy-rules route
    // names the function in a comment saying it deliberately isn't there.)
    expect(src("app", "api", "excursions", "route.ts")).toMatch(/await requirePaidUser\(\)/);
    expect(src("app", "api", "ai-reviews", "trade", "route.ts")).toMatch(/await requirePaidUser\(\)/);
    // ...and Find My Edge is only fetched for them.
    expect(src("app", "insights", "page.tsx")).toMatch(/paid \? getEdgeReport\(/);
    // FREE: plan rules are deliberately ungated, and the mistakes report is
    // fetched for everyone.
    expect(src("app", "api", "strategy-rules", "route.ts")).not.toMatch(/await requirePaidUser\(\)/);
    expect(src("app", "insights", "page.tsx")).not.toMatch(/paid \? getMistakeReport\(/);
    // FREE: screenshot import's parser takes anyone signed in.
    expect(src("app", "api", "ocr", "parse", "route.ts")).not.toMatch(/requirePaidUser|isPaidUser/);
  });
});
