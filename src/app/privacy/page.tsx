import type { Metadata } from "next";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";

export const metadata: Metadata = {
  title: "Privacy Policy — Trading Journal",
  robots: { index: false },
};

export default function PrivacyPage() {
  return (
    <div className="flex flex-1 flex-col">
      <LandingHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16 sm:px-10">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Privacy Policy
        </h1>
        <p className="mt-6 leading-relaxed text-zinc-600 dark:text-zinc-400">
          {"{{TODO: replace with real privacy policy text — cover what data is collected (account info, trade entries, screenshots for OCR), how it's stored (Supabase), and whether it's shared with third parties.}}"}
        </p>
      </main>
      <LandingFooter />
    </div>
  );
}
