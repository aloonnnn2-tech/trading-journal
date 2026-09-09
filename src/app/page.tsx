import { redirect } from "next/navigation";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { Hero } from "@/components/landing/Hero";
import { ThreePillars } from "@/components/landing/ThreePillars";
import { FeatureStories } from "@/components/landing/FeatureStories";
import { SectionHeadline } from "@/components/landing/SectionHeadline";
import { FeatureGrid } from "@/components/landing/FeatureGrid";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { PricingTeaser } from "@/components/landing/PricingTeaser";
import { ClosingCTA } from "@/components/landing/ClosingCTA";
import { LandingFooter } from "@/components/landing/LandingFooter";

// Throwaway preview scaffolding for the Editorial direction. Three variants of
// this page differ on how much visual energy the direction carries; the pick
// decides the real spec, and all of this comes out afterwards.
const VARIANTS = ["a", "b", "c"] as const;
type Variant = (typeof VARIANTS)[number];

const ACCENTS = ["green", "oxblood", "navy"] as const;
type Accent = (typeof ACCENTS)[number];

const VARIANT_LABEL: Record<Variant, string> = {
  a: "A · Restrained",
  b: "B · Bold",
  c: "C · Imagery",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ variant?: string; accent?: string; design?: string }>;
}) {
  const userId = await getUserIdFromHeader();

  if (userId) {
    redirect("/dashboard");
  }

  // Read server-side rather than from localStorage: this page is already a
  // server component, so the attribute is in the first HTML response and the
  // variant never flashes. Anything unrecognised falls back to A.
  const params = await searchParams;
  const variant: Variant = VARIANTS.includes(params.variant as Variant)
    ? (params.variant as Variant)
    : "a";
  // Each variant ships its own accent, which is what was asked for. This
  // override exists so hue can still be judged independently of structure --
  // otherwise the three differ on two axes at once.
  const accent: Accent | undefined = ACCENTS.includes(params.accent as Accent)
    ? (params.accent as Accent)
    : undefined;
  const keepDesign = params.design ? `&design=${params.design}` : "";

  return (
    <div
      // data-v2-variant opts this route into the Editorial layer. Note it
      // replaces data-v2-ready rather than joining it: every Terminal Pro rule
      // is gated on :has([data-v2-ready]), so dropping that marker switches
      // the old direction off here without touching design-v2.css.
      data-v2-variant={variant}
      data-v2-accent={accent}
      className="flex flex-1 flex-col"
    >
      <VariantSwitcher current={variant} accent={params.accent} keepDesign={keepDesign} />
      <LandingHeader />
      <Hero />
      {/* Deliberately alternating shapes down the page: a split hero, three
          tall pillars, two stories beside their visuals and one centred under
          it, a bento of varied tiles, then a horizontal timeline. Every
          section used to be the same bordered box, which is what made
          scrolling feel like the page repeating itself. */}
      <ThreePillars />
      <FeatureStories />
      <SectionHeadline kicker="Capabilities">
        Everything in the box, and what each part costs
      </SectionHeadline>
      <FeatureGrid />
      <HowItWorks />
      <PricingTeaser />
      <ClosingCTA />
      <LandingFooter />
    </div>
  );
}

// Plain links, no JS, no client component -- switching variants is a
// navigation, which is exactly what an <a> is for. Deliberately styled inline
// so it looks identical under every variant: it is scaffolding, not design.
function VariantSwitcher({
  current,
  accent,
  keepDesign,
}: {
  current: Variant;
  accent?: string;
  keepDesign: string;
}) {
  const accentParam = accent ? `&accent=${accent}` : "";
  return (
    <div
      data-v2-switcher
      style={{
        position: "fixed",
        left: 12,
        bottom: 12,
        zIndex: 2147483646,
        display: "flex",
        border: "1px solid #6B757E",
        background: "#0B0D0F",
        font: "11px ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      {VARIANTS.map((v) => (
        <a
          key={v}
          href={`/?variant=${v}${accentParam}${keepDesign}`}
          style={{
            padding: "4px 10px",
            letterSpacing: "0.06em",
            textDecoration: "none",
            background: v === current ? "#C8862A" : "transparent",
            color: v === current ? "#0B0D0F" : "#9AA4AD",
          }}
        >
          {VARIANT_LABEL[v]}
        </a>
      ))}
    </div>
  );
}
