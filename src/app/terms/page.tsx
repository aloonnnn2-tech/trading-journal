import type { Metadata } from "next";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";

export const metadata: Metadata = {
  title: "Terms of Service — Trading Lens",
  robots: { index: false },
};

export default function TermsPage() {
  return (
    <div className="flex flex-1 flex-col">
      <LandingHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16 sm:px-10">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Terms of Service
        </h1>
        <p className="mt-6 leading-relaxed text-zinc-600 dark:text-zinc-400">
          {"{{TODO: replace with real terms of service — cover account eligibility, acceptable use, the free/paid tier split, and disclaimers that this product does not provide financial advice.}}"}
        </p>
      </main>
      <LandingFooter />
    </div>
  );
}
