import type { Metadata } from "next";
import { HomeV2 } from "@/components/landing/v2/HomeV2";
import { BASE_OPEN_GRAPH, HOME_DESCRIPTION, HOME_TITLE } from "@/lib/site";

// Issue 10 of docs/design-audit.md: the homepage was titled "Trading Lens"
// and described in words that could belong to any journal. The strings are
// in src/lib/site.ts, under a test, because they are claims.
//
// `absolute` so no parent template can ever append to it, and og/twitter set
// explicitly: Next does not derive og:title or og:description from the page's
// own title and description, and a share card without them falls back to
// whatever the crawler guesses from the page body.
export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description: HOME_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    ...BASE_OPEN_GRAPH,
    url: "/",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
  },
};
import { isBgVariant } from "@/components/landing/v2/bg/variants";

// The landing page. This is the v2 composition -- promoted here from
// /home-v2 once the side-by-side comparison was settled.
//
// The previous landing page's section list (Hero, ThreePillars, the step
// timeline and the non-v2 feature stories) is not deleted: those components
// still sit in src/components/landing/ and are simply no longer imported, so
// going back is an import list away. The old composition is also recoverable
// verbatim with `git show main:src/app/page.tsx`.
//
// `?bg=` still selects the ground (dots is the chosen default) -- the
// switcher pill is gone but the other grounds stay reachable for a second
// look, exactly as they were on /home-v2.
//
// Signed-in visitors are redirected to /dashboard inside HomeV2, which is the
// same behaviour this route had before.
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ bg?: string | string[] }>;
}) {
  const { bg } = await searchParams;
  return <HomeV2 background={isBgVariant(bg) ? bg : "dots"} />;
}
