import { describe, expect, it } from "vitest";
import { HOME_DESCRIPTION, HOME_TITLE, SITE_NAME, SITE_URL, SOCIAL_PROFILES, siteJsonLd } from "./site";

describe("homepage metadata", () => {
  it("leads the title with the brand", () => {
    expect(HOME_TITLE).toBe(
      "Trading Lenz — Free Trading Journal That Grades Every Trade Against Your Rules",
    );
  });

  it("keeps the description between 140 and 160 characters", () => {
    // Shorter wastes the space search results give it; longer gets cut off
    // mid-sentence.
    expect(HOME_DESCRIPTION.length).toBeGreaterThanOrEqual(140);
    expect(HOME_DESCRIPTION.length).toBeLessThanOrEqual(160);
  });

  it("is the wording Alon chose on 2026-11-19, with the brand name in it", () => {
    expect(HOME_DESCRIPTION).toBe(
      "Free trading journal for swing traders. Snap your broker screenshot and Trading Lenz logs the trade, grades it against your rules and finds your mistakes.",
    );
    expect(HOME_DESCRIPTION).toContain(SITE_NAME);
  });

  it("never presents a paid feature as free", () => {
    // MAE/MFE and the AI features are paid-only and the paid plan is not on
    // sale. If a future edit names one, it must say it is coming/paid.
    for (const paid of ["MAE/MFE", "AI review", "Find My Edge"]) {
      if (HOME_DESCRIPTION.includes(paid)) expect(HOME_DESCRIPTION).toMatch(/paid plan/);
    }
  });

  it("never uses the old spelling", () => {
    expect(`${HOME_TITLE} ${HOME_DESCRIPTION} ${SITE_NAME}`).not.toMatch(/Lens/);
  });
});

describe("site structured data", () => {
  it("names the site Trading Lenz, with the spellings people type", () => {
    const [site, org] = siteJsonLd();
    expect(site).toMatchObject({ "@type": "WebSite", name: "Trading Lenz", url: `${SITE_URL}/` });
    expect(site.alternateName).toContain("TradingLenz");
    expect(org).toMatchObject({ "@type": "Organization", name: "Trading Lenz", sameAs: [...SOCIAL_PROFILES] });
    expect(JSON.stringify(siteJsonLd())).not.toMatch(/Lens/);
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
