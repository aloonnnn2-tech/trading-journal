import type { Metadata } from "next";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";

export const metadata: Metadata = {
  title: "Contact — Trading Lens",
  robots: { index: false },
};

export default function ContactPage() {
  return (
    <div className="flex flex-1 flex-col">
      <LandingHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16 sm:px-10">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Contact</h1>
        <p className="mt-6 leading-relaxed text-zinc-600 dark:text-zinc-400">
          Questions, bug reports, or feedback — reach out any time.
        </p>
        <a
          href="mailto:{{TODO: insert real support email}}"
          className="mt-4 inline-block font-medium text-primary hover:underline"
        >
          {"{{TODO: insert real support email}}"}
        </a>
      </main>
      <LandingFooter />
    </div>
  );
}
