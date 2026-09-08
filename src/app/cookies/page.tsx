import type { Metadata } from "next";
import Link from "next/link";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";

export const metadata: Metadata = {
  title: "Cookies Policy — Trading Lens",
  robots: { index: false },
};

const SECTION_HEADING = "mt-8 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50";
const BODY = "mt-3 leading-relaxed text-zinc-600 dark:text-zinc-400";
const LAST_UPDATED = "September 2026";

// **This page is a factual description of what the running application
// actually stores, written by reading the code -- not a template.** Every item
// in the table below was traced to the line that writes it:
//
//   - Supabase auth cookies ....... src/lib/supabase/{client,server}.ts, src/proxy.ts
//   - theme ....................... next-themes, via ThemeProvider in src/app/layout.tsx
//   - tz-synced ................... src/components/nav-bar.tsx
//   - price_chart_symbol_override:* src/components/trade-card/PriceChart.tsx
//   - analytics session id ........ src/lib/tracking/useAnalytics.ts
//   - analytics session flag ...... src/components/analytics-tracker.tsx
//
// If any of those change, this page is wrong until it is updated with them.
//
// It is deliberately NOT a consent banner. Everything listed is either
// strictly necessary or a first-party preference the user set themselves;
// nothing here is advertising, cross-site tracking, or a third-party
// marketing cookie. See SECURITY.md for the reasoning and for what would
// change that assessment.

function Row({ name, type, purpose }: { name: string; type: string; purpose: string }) {
  return (
    <tr className="border-b border-zinc-100 align-top dark:border-subtle">
      <td className="py-3 pr-4 font-mono text-xs text-zinc-800 dark:text-zinc-200">{name}</td>
      <td className="py-3 pr-4 text-sm text-zinc-500">{type}</td>
      <td className="py-3 text-sm text-zinc-600 dark:text-zinc-400">{purpose}</td>
    </tr>
  );
}

export default function CookiesPage() {
  return (
    <div className="flex flex-1 flex-col">
      <LandingHeader />
      <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-16 sm:px-10">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Cookies Policy
        </h1>
        <p className="mt-4 text-sm text-zinc-500">Last updated: {LAST_UPDATED}</p>

        <p
          className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300"
          role="note"
        >
          <strong className="font-semibold">Pending legal review.</strong> This page accurately
          describes what Trading Lens stores in your browser today, but it has not yet been
          reviewed by a lawyer. If you need a formal compliance statement, please contact us
          before relying on this page.
        </p>

        <p className={BODY}>
          This page explains what Trading Lens stores in your browser, why, and what you can do
          about it. It covers cookies and the two closely-related browser storage mechanisms we
          use, <span className="font-medium">local storage</span> and{" "}
          <span className="font-medium">session storage</span>, because from your point of view
          they do the same sort of thing.
        </p>

        <h2 className={SECTION_HEADING}>The short version</h2>
        <p className={BODY}>
          We use cookies to keep you signed in, and browser storage to remember a few of your own
          display preferences. We do not use advertising cookies, cross-site tracking cookies,
          marketing pixels, or third-party analytics services that profile you. Nothing we store
          is sold or shared with advertisers.
        </p>

        <h2 className={SECTION_HEADING}>What we store</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-subtle">
                <th className="py-2 pr-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Name
                </th>
                <th className="py-2 pr-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Kind
                </th>
                <th className="py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  What it does
                </th>
              </tr>
            </thead>
            <tbody>
              <Row
                name="sb-*-auth-token"
                type="Cookie (essential)"
                purpose="Keeps you signed in between page loads and visits. Set by Supabase, our authentication provider. Without it you would be signed out on every click."
              />
              <Row
                name="theme"
                type="Local storage (preference)"
                purpose="Remembers whether you chose light or dark mode, so the right one is applied before the page paints."
              />
              <Row
                name="tz-synced"
                type="Local storage (functional)"
                purpose="Records that your time zone has already been sent to your account, so the app doesn't repeat that request on every page load."
              />
              <Row
                name="price_chart_symbol_override:*"
                type="Local storage (preference)"
                purpose="Remembers the market symbol you picked for a given ticker, so its price chart resolves to the right instrument next time."
              />
              <Row
                name="tj-analytics-session-id"
                type="Session storage (functional)"
                purpose="A random id that groups your activity in one browser tab into a single visit, so we can count usage of our own features. Cleared when you close the tab."
              />
              <Row
                name="tj-analytics-session-started"
                type="Session storage (functional)"
                purpose="Records that this visit has already been counted, so it isn't counted twice."
              />
            </tbody>
          </table>
        </div>

        <h2 className={SECTION_HEADING}>About our usage analytics</h2>
        <p className={BODY}>
          Trading Lens counts feature usage using its own database — not Google Analytics, and not
          any third-party analytics or advertising service. These counts only run when you are
          signed in; they are switched off entirely on the home page, the sign-in and sign-up
          pages, and the legal pages. We record which pages of the app were opened and which
          features were used. We do not put the contents of your trades, notes, or journal
          entries into analytics.
        </p>

        <h2 className={SECTION_HEADING}>Error monitoring</h2>
        <p className={BODY}>
          We use Sentry, a third-party error-monitoring service, to be told when the app breaks.
          When an error or a slow page occurs, Sentry receives technical details about it —
          typically the page address, your browser and operating system version, and your IP
          address. Sentry does not set cookies here, and we have session replay switched off, so
          it does not record your screen or your keystrokes.
        </p>

        <h2 className={SECTION_HEADING}>If you use the AI features</h2>
        <p className={BODY}>
          The AI features are optional, off by default, and require you to add your own API key
          for an AI provider you choose. If you turn them on, the trade data needed to answer
          your question is sent to that provider. We ask for your explicit agreement per provider
          before this happens for the first time. See our{" "}
          <Link href="/privacy" className="font-medium text-primary hover:underline">
            Privacy Policy
          </Link>{" "}
          for more.
        </p>

        <h2 className={SECTION_HEADING}>Your choices</h2>
        <p className={BODY}>
          Every browser lets you view, block, and delete cookies and site data, usually under
          Settings → Privacy. You can clear Trading Lens&apos;s stored data at any time. Be aware
          that blocking the authentication cookie will sign you out and prevent you from signing
          back in, because that cookie is what keeps your session alive — it is not optional in
          the way a preference is.
        </p>
        <p className={BODY}>
          We do not show a cookie consent banner, because at present we do not set any
          advertising, marketing, or cross-site tracking cookies that would require your prior
          consent. If that ever changes, we will ask you first.
        </p>

        <h2 className={SECTION_HEADING}>Changes to this policy</h2>
        <p className={BODY}>
          If what we store changes in a meaningful way, we&apos;ll update this page and the date
          at the top of it.
        </p>

        <h2 className={SECTION_HEADING}>Contact</h2>
        <p className={BODY}>
          Questions about this policy:{" "}
          <a
            href="mailto:TradingLenzSupport@proton.me"
            className="font-medium text-primary hover:underline"
          >
            TradingLenzSupport@proton.me
          </a>
        </p>
      </div>
      <LandingFooter />
    </div>
  );
}
