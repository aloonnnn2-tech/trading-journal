import type { Metadata } from "next";

// What the site says about itself, in one place.
//
// Held here rather than inline in layout.tsx and page.tsx for two reasons.
// Next REPLACES a child segment's `openGraph` object rather than merging it
// with the parent's, so a page that sets its own og:title silently drops the
// site name unless it spreads these in again. And the homepage strings are
// claims -- the description names features, some of them paid -- so they sit
// under a test (site.test.ts) instead of being edited in passing.

/**
 * The production origin, hardcoded on purpose. Next needs it (`metadataBase`)
 * to turn the share image's path into the absolute URL that Facebook, X and
 * Slack require. Netlify's own `URL` variable is only dependable at build
 * time, and a share link pointing at localhost or a deploy preview is broken
 * for everyone who clicks it. Change this if the site moves to its own domain.
 */
export const SITE_URL = "https://tradinglenz.netlify.app";

export const SITE_NAME = "Trading Lenz";

/** From docs/design-audit.md, issue 10, verbatim. */
export const HOME_TITLE = "Trading Lenz \u2014 Free Trading Journal That Grades Every Trade Against Your Rules";

/**
 * The text Google shows under the title. 140-160 characters, with the brand
 * name in it: people search "trading lenz", and a description that never
 * says it gives Google less to match. Alon chose this wording on 2026-11-19
 * (swing traders, screenshot first, as the outside review's positioning
 * suggested), replacing the 2026-09-26 one, which ended on "MAE/MFE coming on
 * the paid plan. No card." Nothing here may present a paid feature as free.
 */
export const HOME_DESCRIPTION =
  "Free trading journal for swing traders. Snap your broker screenshot and Trading Lenz logs the trade, grades it against your rules and finds your mistakes.";

/** Where the brand lives off the site, so search engines tie them together. */
export const SOCIAL_PROFILES = [
  "https://www.youtube.com/@TradingLenz",
  "https://www.tiktok.com/@trading_lenz",
  "https://www.instagram.com/tradinglenz/",
] as const;

/**
 * Structured data for the homepage: the site's name as Google should show it
 * ("Trading Lenz", never the "Trading Lens" it indexed before the rename),
 * the spellings people type, and the brand's profiles.
 * https://developers.google.com/search/docs/appearance/site-names
 */
export function siteJsonLd(): Record<string, unknown>[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      alternateName: ["TradingLenz", "Trading Lenz trading journal"],
      url: `${SITE_URL}/`,
    },
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: SITE_NAME,
      url: `${SITE_URL}/`,
      logo: `${SITE_URL}/brand-mark.png`,
      sameAs: [...SOCIAL_PROFILES],
    },
  ];
}

/** The Open Graph fields every page should carry. Spread into any page that
 *  sets its own `openGraph`, or it loses these. */
export const BASE_OPEN_GRAPH = {
  siteName: SITE_NAME,
  type: "website",
  locale: "en_US",
} satisfies Metadata["openGraph"];
