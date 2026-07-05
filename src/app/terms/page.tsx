import type { Metadata } from "next";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";

export const metadata: Metadata = {
  title: "Terms of Service — Trading Lens",
  robots: { index: false },
};

const SECTION_HEADING = "mt-8 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50";
const BODY = "mt-3 leading-relaxed text-zinc-600 dark:text-zinc-400";
const LAST_UPDATED = "July 2026";

export default function TermsPage() {
  return (
    <div className="flex flex-1 flex-col">
      <LandingHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16 sm:px-10">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Terms of Service
        </h1>
        <p className="mt-4 text-sm text-zinc-500">Last updated: {LAST_UPDATED}</p>

        <p className={BODY}>
          By creating an account or using Trading Lens (&quot;the Service&quot;), you agree to
          these terms. If you don&apos;t agree, please don&apos;t use the Service.
        </p>

        <h2 className={SECTION_HEADING}>Not financial advice</h2>
        <p className={BODY}>
          Trading Lens does not provide investment, financial, or trading advice. Any
          statistics, charts, or insights generated from your journal entries are for your own
          informational and record-keeping purposes only. Trading involves risk, including the
          risk of loss, and you are solely responsible for your own trading decisions.
        </p>

        <h2 className={SECTION_HEADING}>Contact</h2>
        <p className={BODY}>
          Questions about these terms:{" "}
          <a href="mailto:support@tradinglens.app" className="font-medium text-primary hover:underline">
            support@tradinglens.app
          </a>
        </p>
      </main>
      <LandingFooter />
    </div>
  );
}
