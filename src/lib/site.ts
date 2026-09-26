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

export const SITE_NAME = "Trading Lens";

/** From docs/design-audit.md, issue 10, verbatim. */
export const HOME_TITLE = "Trading Lens \u2014 Free Trading Journal That Grades Every Trade Against Your Rules";

/**
 * 140-160 characters, naming trading rules, mistake tracking, MAE/MFE,
 * screenshot import and "free, no card" (issue 10). MAE/MFE is a paid feature
 * and the paid plan is not on sale, so it is named as coming rather than as
 * included: the spec's own wording would have implied it was free, which its
 * one rule forbids. Alon chose this wording on 2026-09-26.
 */
export const HOME_DESCRIPTION =
  "A free trading journal that grades every trade against your rules, with mistake tracking and screenshot import. MAE/MFE coming on the paid plan. No card.";

/** The Open Graph fields every page should carry. Spread into any page that
 *  sets its own `openGraph`, or it loses these. */
export const BASE_OPEN_GRAPH = {
  siteName: SITE_NAME,
  type: "website",
  locale: "en_US",
} satisfies Metadata["openGraph"];
