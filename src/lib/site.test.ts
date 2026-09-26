import { describe, expect, it } from "vitest";
import { HOME_DESCRIPTION, HOME_TITLE, SITE_URL } from "./site";

describe("homepage metadata", () => {
  it("uses the title the spec asks for, exactly", () => {
    expect(HOME_TITLE).toBe(
      "Trading Lens \u2014 Free Trading Journal That Grades Every Trade Against Your Rules",
    );
  });

  it("keeps the description between 140 and 160 characters", () => {
    // Shorter wastes the space search results give it; longer gets cut off
    // mid-sentence, and the part that gets cut is the "No card".
    expect(HOME_DESCRIPTION.length).toBeGreaterThanOrEqual(140);
    expect(HOME_DESCRIPTION.length).toBeLessThanOrEqual(160);
  });

  it("names each thing the spec asks for", () => {
    for (const phrase of ["rules", "mistake tracking", "MAE/MFE", "screenshot import", "free", "No card"]) {
      expect(HOME_DESCRIPTION).toContain(phrase);
    }
  });

  it("never presents MAE/MFE as included for free", () => {
    // MAE/MFE is paid-only (FeatureGrid marks it paid; /analytics only fetches
    // excursions for paid accounts) and the paid plan is not on sale. If a
    // future edit drops the qualifier, this fails rather than shipping a claim
    // the product cannot back.
    expect(HOME_DESCRIPTION).toMatch(/MAE\/MFE coming on the paid plan/);
  });
});

describe("SITE_URL", () => {
  it("is an absolute https origin with no trailing slash", () => {
    const url = new URL(SITE_URL);
    expect(url.protocol).toBe("https:");
    expect(url.pathname).toBe("/");
    expect(SITE_URL.endsWith("/")).toBe(false);
  });
});
