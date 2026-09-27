import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { MotionConfig } from "framer-motion";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { Hero } from "@/components/landing/v2/Hero";
import { HowItWorks } from "@/components/landing/v2/HowItWorks";
import { FeatureTour } from "@/components/landing/v2/FeatureTour";
import { NoMadeUpNumbers } from "@/components/landing/v2/NoMadeUpNumbers";
import { TrustTrio } from "@/components/landing/v2/TrustTrio";
import { SectionHeadline } from "@/components/landing/v2/SectionHeadline";
import { ClosingCTA } from "@/components/landing/v2/ClosingCTA";
import { BgProvider } from "@/components/landing/v2/bg/BgContext";
import { Background } from "@/components/landing/v2/bg/Background";
import type { BgVariant } from "@/components/landing/v2/bg/variants";
import { FeatureGrid } from "@/components/landing/FeatureGrid";
import { PricingTeaser } from "@/components/landing/v2/PricingTeaser";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { PublicViewBeacon } from "@/components/public-view-beacon";
import { Band } from "@/components/landing/v2/Band";
import { AnnouncementBar } from "@/components/landing/v2/AnnouncementBar";
import { ANNOUNCEMENT_SCRIPT } from "@/components/landing/v2/announcement";
import { ImportStrip } from "@/components/landing/v2/ImportStrip";
import { Faq } from "@/components/landing/v2/Faq";

// The /home-v2 candidate. / is unchanged.
//
// Differences from /: the hero and first plate, a rotating three-card
// process stack in place of both Three Pillars and the step timeline, a
// tabbed feature tour (Phase 3B) in place of the feature stories, the Find My
// Edge plate and the proof section, and v2 versions of the "What's included"
// headline, the pricing section and the closing CTA. The bento, the header
// and the footer are the shared components.
//
// The ground is the dot lattice. The other six grounds that were compared
// (plain, grid, chart, noise, tint, beams) stay reachable with `?bg=` for a
// second look, but the switcher pill is gone: the choice is made. Every
// ground is a layer painted behind content, so all are the same height to
// the pixel. Deliberately not carrying data-v2-page="landing": that
// attribute belongs to the dormant Design V2 flag and would clamp the
// headline this page exists to enlarge.
//
// MOTION POLICY: this page honours prefers-reduced-motion, like the rest of
// the app. That is a reversal, and the reasoning is worth keeping.
//
// It used to set reducedMotion="never" on purpose. The argument was that on
// Windows the setting behind that query is Settings > Accessibility > Visual
// effects > "Animation effects", which ships OFF on many machines and is
// switched off by Battery Saver -- a far noisier signal than the deliberate
// Reduce Motion toggle on macOS/iOS. Honouring it left the larger share of
// visitors on a page whose hero, process cards and proof strip sat dead
// still, which read as broken rather than as considerate. The stated cost was
// that someone who set the preference *because* movement makes them unwell
// got the motion regardless.
//
// What changed is why that cost is no longer worth paying. The "dead still"
// failure was caused by content that STARTED INVISIBLE and waited for an
// animation to reveal it -- turn the animation off and the page is blank.
// Since docs/design-audit.md issue 7, nothing here starts invisible: the
// server HTML is the finished page and motion is a 200ms settle applied
// afterwards, only to things still off screen. With the preference set the
// page now renders complete and simply does not slide. There is nothing left
// for the override to protect.
//
// Two other places carried the same decision: the orbit's rAF loop in
// HowItWorks.tsx (which still runs under reduced motion -- see the note there)
// and CountUp.tsx (deleted --
// the figures are in the HTML). The global reduced-motion rules live in
// globals.css.
//
// SCOPE NOTE, because the old comment here was wrong by the time it was read:
// this file is no longer /home-v2 only. src/app/page.tsx renders HomeV2, so
// this is the live landing page, and the override was reaching every visitor
// to it.

export async function HomeV2({ background }: { background: BgVariant }) {
  const userId = await getUserIdFromHeader();

  if (userId) {
    redirect("/dashboard");
  }

  // For the announcement bar's pre-paint script: src/proxy.ts sends a CSP
  // with a per-request nonce and no 'unsafe-inline', so an inline script
  // without it is blocked. Same source as layout.tsx's.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <MotionConfig reducedMotion="user">
      <BgProvider initial={background}>
        {/* overflow-x-clip here, not on the sections: anything that bleeds past
            its section is clipped at the viewport edge, where the cut is
            invisible. Vertical bleed stays free. */}
        <div data-v2-home className="relative flex flex-1 flex-col overflow-x-clip">
          {/* Anonymous view count only -- see the component. Renders nothing. */}
          <PublicViewBeacon path="/" />
          <Background />
          {/* Phase 2C. The script runs before the bar is parsed, so a visitor
              who closed it never sees it drawn -- see announcement.ts. */}
          <script nonce={nonce} dangerouslySetInnerHTML={{ __html: ANNOUNCEMENT_SCRIPT }} />
          <AnnouncementBar />
          <LandingHeader />
          <Hero />
          <ImportStrip />
          {/* Alternating bands (Phase 2A), in the spec's target order: How it
              works straight after the hero, where "See how it works" lands
              (3A); then the tabbed tour, which is where the nav's "Features"
              link lands (3B). "Three jobs a plain record leaves to you" went
              in 3B: each of its points is a tour tab now, with the right
              badge. 3C adds "No made-up numbers" after the tour and the
              trust trio before pricing; 3D's compare table will sit between
              What's included and the trio. The closing CTA's own card carries
              the CTA colour. */}
          <Band tone="raised">
            <HowItWorks />
          </Band>
          <Band tone="base">
            <FeatureTour />
          </Band>
          <Band tone="raised">
            <NoMadeUpNumbers />
          </Band>
          <Band tone="base">
            <SectionHeadline kicker="Features">What’s included</SectionHeadline>
            <FeatureGrid />
          </Band>
          <Band tone="raised">
            <TrustTrio />
          </Band>
          <Band tone="base">
            <PricingTeaser />
          </Band>
          <Band tone="raised">
            <Faq />
          </Band>
          <ClosingCTA />
          <LandingFooter />
        </div>
      </BgProvider>
    </MotionConfig>
  );
}
