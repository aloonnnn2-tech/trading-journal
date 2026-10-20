import type { Metadata } from "next";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import Link from "next/link";
import { HELP_EMAIL } from "@/lib/help/config";

export const metadata: Metadata = {
  title: "Contact — Trading Lens",
  robots: { index: false },
};

export default function ContactPage() {
  return (
    <div className="flex flex-1 flex-col">
      <LandingHeader />
      {/* Was <main>. The root layout now provides the single <main>
          landmark for every page, and nesting a second one inside it is
          invalid and gives assistive tech two competing "main" targets. */}
      <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-16 sm:px-10">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Contact</h1>
        <p className="mt-6 leading-relaxed text-zinc-600 dark:text-zinc-400">
          Questions, bug reports, or feedback. Reach out any time.
        </p>
        <Link
          href="/help?from=/contact"
          className="mt-6 inline-block rounded-lg bg-primary px-5 py-2.5 font-medium text-white hover:brightness-110 dark:text-zinc-950"
        >
          Send us a message
        </Link>
        <p className="mt-6 text-sm text-zinc-500">Or email us:</p>
        <a href={`mailto:${HELP_EMAIL}`} className="mt-1 inline-block font-medium text-primary hover:underline">
          {HELP_EMAIL}
        </a>
      </div>
      <LandingFooter />
    </div>
  );
}
