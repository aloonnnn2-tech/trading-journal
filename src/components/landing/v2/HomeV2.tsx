import { redirect } from "next/navigation";
import { MotionConfig } from "framer-motion";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { Hero } from "@/components/landing/v2/Hero";
import { ProductShot } from "@/components/landing/v2/ProductShot";
import { HowItWorks } from "@/components/landing/v2/HowItWorks";
import { FeatureStories } from "@/components/landing/v2/FeatureStories";
import { SectionHeadline } from "@/components/landing/v2/SectionHeadline";
import { WhatsDifferent } from "@/components/landing/v2/WhatsDifferent";
import { ClosingCTA } from "@/components/landing/v2/ClosingCTA";
import { BgProvider } from "@/components/landing/v2/bg/BgContext";
import { Background } from "@/components/landing/v2/bg/Background";
import type { BgVariant } from "@/components/landing/v2/bg/variants";
import { FeatureGrid } from "@/components/landing/FeatureGrid";
import { PricingTeaser } from "@/components/landing/v2/PricingTeaser";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { PublicViewBeacon } from "@/components/public-view-beacon";

// The /home-v2 candidate. / is unchanged.
//
// Differences from /: the hero and first plate, a rotating three-card
// process stack in place of both Three Pillars and the step timeline, and
// v2 versions of the feature stories, the "What's included" headline, the
// proof section, the pricing section and the closing CTA that move as they
// arrive -- each from its own side of the page. The bento, the header and
// the footer are the shared components.
//
// The ground is the dot lattice. The other six grounds that were compared
// (plain, grid, chart, noise, tint, beams) stay reachable with `?bg=` for a
// second look, but the switcher pill is gone: the choice is made. Every
// ground is a layer painted behind content, so all are the same height to
// the pixel. Deliberately not carrying data-v2-page="landing": that
// attribute belongs to the dormant Design V2 flag and would clamp the
// headline this page exists to enlarge.
//
// MOTION POLICY, AND IT IS DELIBERATE: this page animates for everyone,
// including visitors whose OS reports prefers-reduced-motion. That is an
// owner decision taken with the trade-off stated, not an oversight, and it is
// why reducedMotion is "never" rather than "user".
//
// Why: on Windows the setting behind that query is Settings > Accessibility >
// Visual effects > "Animation effects", which ships OFF on many machines and
// is switched off by Battery Saver. It is therefore a far noisier signal than
// the deliberate Reduce Motion toggle on macOS/iOS. Honouring it here meant
// the larger share of visitors landed on a page whose hero, process cards and
// proof strip all sat dead still -- read as broken rather than as considerate.
//
// The cost, stated plainly: a visitor who set that preference *because*
// movement makes them unwell gets the motion anyway on this page. That is the
// accepted trade.
//
// SCOPE: this override stops at /home-v2. The signed-in app, and the live /
// landing page, still honour prefers-reduced-motion normally -- nothing here
// reaches them. If that ever needs revisiting, the three places that carry
// this decision are this MotionConfig, the orbit's rAF loop in HowItWorks.tsx,
// and CountUp.tsx.

export async function HomeV2({ background }: { background: BgVariant }) {
  const userId = await getUserIdFromHeader();

  if (userId) {
    redirect("/dashboard");
  }

  return (
    <MotionConfig reducedMotion="never">
      <BgProvider initial={background}>
        {/* overflow-x-clip here, not on the sections: anything that bleeds past
            its section is clipped at the viewport edge, where the cut is
            invisible. Vertical bleed stays free. */}
        <div data-v2-home className="relative flex flex-1 flex-col overflow-x-clip">
          {/* Anonymous view count only -- see the component. Renders nothing. */}
          <PublicViewBeacon path="/" />
          <Background />
          <LandingHeader />
          <Hero />
          <ProductShot />
          <HowItWorks />
          <FeatureStories />
          <SectionHeadline kicker="Features">What’s included</SectionHeadline>
          <FeatureGrid />
          <WhatsDifferent />
          <PricingTeaser />
          <ClosingCTA />
          <LandingFooter />
        </div>
      </BgProvider>
    </MotionConfig>
  );
}
