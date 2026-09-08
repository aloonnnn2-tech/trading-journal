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

export default async function Home() {
  const userId = await getUserIdFromHeader();

  if (userId) {
    redirect("/dashboard");
  }

  return (
    <div className="flex flex-1 flex-col">
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
