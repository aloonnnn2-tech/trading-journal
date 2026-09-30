import { describe, expect, it } from "vitest";
import { NAV_GROUPS, PRIMARY_LINKS } from "@/lib/nav/links";
import { TOURS } from "./steps";
import { navDirections } from "./nav-target";

// When the tour's next stop is on another page, it points at the menu instead
// of moving the user there itself. These pin what it points at.

const shown = (...ids: string[]) => (id: string) => ids.includes(id);

describe("navDirections", () => {
  it("points at a top-level link directly", () => {
    expect(navDirections("/strategies", shown("nav-strategies"))).toEqual({
      targetId: "nav-strategies",
      kind: "link",
      label: "Strategies",
      groupLabel: null,
    });
  });

  it("points at the dropdown first when the item is inside a closed menu", () => {
    expect(navDirections("/insights", shown("nav-group-analysis"))).toEqual({
      targetId: "nav-group-analysis",
      kind: "group",
      label: "Insights",
      groupLabel: "Analysis",
    });
  });

  it("moves to the item itself once its menu is open", () => {
    expect(navDirections("/insights", shown("nav-group-analysis", "nav-insights")).targetId).toBe("nav-insights");
  });

  it("has nothing to point at when the menu is folded away", () => {
    expect(navDirections("/analytics", shown())).toEqual({
      targetId: null,
      kind: "none",
      label: "Analytics",
      groupLabel: "Analysis",
    });
  });

  it("on a phone, points at the tab bar's More button for pages inside it", () => {
    expect(navDirections("/insights", shown("nav-more"))).toEqual({
      targetId: "nav-more",
      kind: "group",
      label: "Insights",
      groupLabel: "More",
    });
    // ...and at the item once the More sheet is open.
    expect(navDirections("/insights", shown("nav-more", "nav-insights")).targetId).toBe("nav-insights");
  });

  it("knows a menu item for every page a tour visits", () => {
    const menu = new Set([...PRIMARY_LINKS, ...NAV_GROUPS.flatMap((g) => g.links)].map((l) => l.href));
    for (const [name, steps] of Object.entries(TOURS)) {
      for (const step of steps) {
        if (step.path) expect({ tour: name, path: step.path, inMenu: menu.has(step.path) }).toEqual({ tour: name, path: step.path, inMenu: true });
      }
    }
  });
});
