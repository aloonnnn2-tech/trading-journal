import type { Metadata } from "next";
import Link from "next/link";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";

export const metadata: Metadata = {
  title: "Privacy Policy — Trading Lens",
  robots: { index: false },
};

const SECTION_HEADING = "mt-8 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50";
const BODY = "mt-3 leading-relaxed text-zinc-600 dark:text-zinc-400";
const LAST_UPDATED = "July 2026";

export default function PrivacyPage() {
  return (
    <div className="flex flex-1 flex-col">
      <LandingHeader />
      {/* Was <main>. The root layout now provides the single <main>
          landmark for every page, and nesting a second one inside it is
          invalid and gives assistive tech two competing "main" targets. */}
      <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-16 sm:px-10">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Privacy Policy
        </h1>
        <p className="mt-4 text-sm text-zinc-500">Last updated: {LAST_UPDATED}</p>

        <p className={BODY}>
          Trading Lens (&quot;we&quot;, &quot;us&quot;) is a personal trading journal. This
          page explains what information we collect, how we use it, and the choices you have.
          We built Trading Lens to hold your own trading data, not to monetize it. We don&apos;t
          sell your information to anyone.
        </p>

        <h2 className={SECTION_HEADING}>Information we collect</h2>
        <p className={BODY}>
          <strong className="text-zinc-800 dark:text-zinc-200">Account information:</strong> the
          email address and password you sign up with. Passwords are handled by our
          authentication provider (Supabase Auth) and are never visible to us in plain text.
        </p>
        <p className={BODY}>
          <strong className="text-zinc-800 dark:text-zinc-200">Trade journal data:</strong>{" "}
          everything you enter yourself. Tickers, prices, dates, notes, custom fields, emotion
          tags, and any folders or tags you create to organize trades.
        </p>
        <p className={BODY}>
          <strong className="text-zinc-800 dark:text-zinc-200">Screenshots you upload:</strong> if
          you use the screenshot import feature, the image is processed to automatically read
          trade details off it (an on-device OCR step, described below) and is then stored as an
          attachment on that trade so you can refer back to it.
        </p>

        <h2 className={SECTION_HEADING}>How screenshot processing works</h2>
        <p className={BODY}>
          Screenshot text extraction runs entirely on our own servers using offline OCR software.
          Your screenshots are never sent to a third-party AI or OCR API to be read. The
          recognition model runs locally as part of our infrastructure, and the image itself is
          stored in your account&apos;s private storage, not shared externally.
        </p>

        <h2 className={SECTION_HEADING}>Where your data is stored</h2>
        <p className={BODY}>
          Trading Lens is built on Supabase, which provides our database, file storage, and
          authentication. Supabase acts as our infrastructure provider (a data processor) and
          does not use your data for its own purposes. Data is protected by access rules that
          restrict every account to seeing only its own data.
        </p>

        <h2 className={SECTION_HEADING}>Cookies and browser storage</h2>
        <p className={BODY}>
          We use a small number of essential cookies to keep you signed in between visits, and
          browser storage to remember display preferences you set yourself. We don&apos;t use
          advertising or third-party tracking cookies. Our{" "}
          <Link href="/cookies" className="font-medium text-primary hover:underline">
            Cookies Policy
          </Link>{" "}
          lists every item by name and explains what each one does.
        </p>

        <h2 className={SECTION_HEADING}>Usage analytics</h2>
        <p className={BODY}>
          We count how our own features get used — which pages of the app are opened and which
          actions are taken — and store those counts in our own database. We don&apos;t use
          Google Analytics or any third-party analytics or advertising service. These counts run
          only while you&apos;re signed in, and are switched off on the home page, the sign-in
          and sign-up pages, and these legal pages. The contents of your trades, notes, and
          journal entries are never recorded in analytics.
        </p>

        <h2 className={SECTION_HEADING}>Error monitoring</h2>
        <p className={BODY}>
          We use Sentry, a third-party error-monitoring service, to be alerted when something in
          the app breaks. When an error or a slow page occurs, Sentry receives technical details
          about it — typically the page address, your browser and operating system version, and
          your IP address — so we can find and fix the fault. Session replay is switched off, so
          Sentry does not record your screen or your keystrokes. Sentry acts as a data processor
          on our behalf.
        </p>

        <h2 className={SECTION_HEADING}>The optional AI features</h2>
        <p className={BODY}>
          Trading Lens can answer questions about your journal and write trade reviews using an
          AI provider. This is <strong className="text-zinc-800 dark:text-zinc-200">off by
          default</strong> and only works if you supply your own API key for a provider you
          choose. If you turn it on, the trade data needed to answer your question is sent to
          that provider, and their privacy policy and data-retention terms then apply to it. We
          ask for your explicit agreement for each provider before anything is sent for the first
          time, and you can remove your key and withdraw that agreement at any time. Your API key
          is stored encrypted and is never exposed to your browser.
        </p>

        <h2 className={SECTION_HEADING}>Your data, your control</h2>
        <p className={BODY}>
          You can export your trade data at any time from within the app. If you&apos;d like your
          account and all associated data permanently deleted, contact us (see below) and we
          will process the request.
        </p>

        <h2 className={SECTION_HEADING}>Children&apos;s privacy</h2>
        <p className={BODY}>
          Trading Lens is not directed at, or intended for use by, anyone under 18.
        </p>

        <h2 className={SECTION_HEADING}>Changes to this policy</h2>
        <p className={BODY}>
          If this policy changes in a meaningful way, we&apos;ll update the date at the top of
          this page.
        </p>

        <h2 className={SECTION_HEADING}>Contact</h2>
        <p className={BODY}>
          Questions about this policy or your data:{" "}
          <a href="mailto:TradingLenzSupport@proton.me" className="font-medium text-primary hover:underline">
            TradingLenzSupport@proton.me
          </a>
        </p>
      </div>
      <LandingFooter />
    </div>
  );
}
