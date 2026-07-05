import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { Hero } from "@/components/landing/Hero";
import { FeatureStories } from "@/components/landing/FeatureStories";
import { SectionHeadline } from "@/components/landing/SectionHeadline";
import { FeatureGrid } from "@/components/landing/FeatureGrid";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { PricingTeaser } from "@/components/landing/PricingTeaser";
import { ClosingCTA } from "@/components/landing/ClosingCTA";
import { LandingFooter } from "@/components/landing/LandingFooter";

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (data.user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex flex-1 flex-col">
      <LandingHeader />
      <Hero />
      <FeatureStories />
      <SectionHeadline kicker="Capabilities">Everything your trading edge needs</SectionHeadline>
      <FeatureGrid />
      <HowItWorks />
      <PricingTeaser />
      <ClosingCTA />
      <LandingFooter />
    </div>
  );
}
