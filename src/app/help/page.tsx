import type { Metadata } from "next";
import { Suspense } from "react";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { HELP_EMAIL } from "@/lib/help/config";
import { HelpForm } from "./help-form";

export const metadata: Metadata = {
  title: "Get help — Trading Lens",
  description: "Ask the Trading Lens team for help. No account needed.",
};

// "Get help", open to everyone: no account and no sign-in needed, so it also
// works for someone who can't sign in. Requests land in /admin/help.
export default function HelpPage() {
  return (
    <div className="flex flex-1 flex-col">
      <LandingHeader />
      <div className="mx-auto w-full max-w-xl flex-1 px-6 py-16 sm:px-10">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Get help</h1>
        <p className="mt-3 leading-relaxed text-zinc-600 dark:text-zinc-400">
          Trouble signing in, something not working, or a question? Tell us here. You don&apos;t need an account.
        </p>
        <div className="mt-8">
          {/* useSearchParams in the form needs a boundary to keep this page static. */}
          <Suspense fallback={null}>
            <HelpForm />
          </Suspense>
        </div>
        <p className="mt-6 text-sm text-zinc-500">
          Prefer email?{" "}
          <a href={`mailto:${HELP_EMAIL}`} className="font-medium text-primary hover:underline">
            {HELP_EMAIL}
          </a>
        </p>
      </div>
      <LandingFooter />
    </div>
  );
}
