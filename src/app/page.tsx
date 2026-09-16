import { HomeV2 } from "@/components/landing/v2/HomeV2";
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
