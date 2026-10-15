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
const LAST_UPDATED = "October 2026";

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
          authentication provider (Supabase Auth) and are never visible to us in plain text. If
          you sign in with Google instead, Google confirms who you are and shares your email
          address, name and profile picture with Supabase Auth, which stores them with your
          account; we never see your Google password.
        </p>
        <p className={BODY}>
          <strong className="text-zinc-800 dark:text-zinc-200">Trade journal data:</strong>{" "}
          everything you enter yourself. Tickers, prices, dates, notes, custom fields, emotion
          tags, and any folders or tags you create to organize trades.
        </p>
        <p className={BODY}>
          <strong className="text-zinc-800 dark:text-zinc-200">Screenshots you upload:</strong> if
          you use the screenshot import feature, the image is processed to automatically read
          trade details off it (by text-recognition software running on our own servers,
          described below) and is then stored as an attachment on that trade so you can refer
          back to it.
        </p>
        <p className={BODY}>
          <strong className="text-zinc-800 dark:text-zinc-200">Your sign-up agreement:</strong> when you
          create an account we record that you confirmed you are 18 or older and accepted these
          terms, which version you accepted, and when.
        </p>
        {/* Added with the waitlist (Phase 2B of docs/design-audit.md): the
            form collects addresses from people with no account, which the
            three items above do not cover. Wording approved by Alon on
            2026-09-27. Every clause is a promise -- keep them true. */}
        <p className={BODY}>
          <strong className="text-zinc-800 dark:text-zinc-200">Paid-plan waitlist:</strong> if you
          join the waitlist, we store the email address you enter, the page you joined from, and
          when. We use it only to tell you when the paid plan launches &mdash; it isn&apos;t shared
          or sold, and it isn&apos;t linked to a Trading Lens account. To be removed, email{" "}
          <a
            href="mailto:TradingLenzSupport@proton.me"
            className="font-medium text-primary hover:underline"
          >
            TradingLenzSupport@proton.me
          </a>
          .
        </p>
        {/* Added with reviews (0064, 2026-10-11). Every clause is a promise. */}
        <p className={BODY}>
          <strong className="text-zinc-800 dark:text-zinc-200">Reviews of Trading Lens:</strong> if you rate
          Trading Lens, we store your stars, your comment, the name you chose to show (if any), whether you
          allowed it to be shown publicly, and where you were asked. A review appears on our homepage only if
          you allowed it and we chose it, and then only the stars, the comment, the name you chose and the
          month &mdash; never your email. You can change or remove your review any time from the account menu
          (Rate Trading Lens), and it is deleted with your account.
        </p>

        <h2 className={SECTION_HEADING}>How screenshot processing works</h2>
        <p className={BODY}>
          Screenshot text extraction runs entirely on our own servers using offline OCR software.
          By default your screenshots are never sent to a third-party AI or OCR API to be read. On
          the paid plan you can choose &ldquo;Read with AI&rdquo; for a screenshot: that one image is then
          sent to the AI provider of your own key, only after you agree for that provider. The
          recognition model runs locally as part of our infrastructure, and the image itself is
          stored in your account&apos;s private storage.
        </p>

        <h2 className={SECTION_HEADING}>Where your data is stored</h2>
        <p className={BODY}>
          Trading Lens is built on Supabase, which provides our database, file storage, and
          authentication. Supabase acts as our infrastructure provider (a data processor) and
          does not use your data for its own purposes. Data is protected by access rules that
          restrict every account to seeing only its own data.
        </p>

        <h2 className={SECTION_HEADING}>Other services that receive data</h2>
        <p className={BODY}>
          <strong className="text-zinc-800 dark:text-zinc-200">Netlify</strong> hosts the app: the
          pages and the server functions your browser talks to run on Netlify. Like any web host,
          it receives your IP address and the requests your browser makes in order to serve them.
        </p>
        <p className={BODY}>
          <strong className="text-zinc-800 dark:text-zinc-200">Cloudflare Turnstile</strong> is the
          security check on the sign-in, sign-up and password-reset pages, and only runs on
          those pages. To tell people from automated sign-in attempts, Cloudflare receives
          technical information such as your IP address and details of your browser.
          Cloudflare&apos;s own privacy policy applies to that check.
        </p>
        <p className={BODY}>
          <strong className="text-zinc-800 dark:text-zinc-200">Yahoo Finance</strong> is where our
          server gets the price history behind charts and excursion figures. Only a ticker symbol
          and a date range are sent, from our server &mdash; never your name, email, account or
          any trade details.
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
          actions are taken, including which buttons are pressed — and store those counts in our
          own database. We don&apos;t use Google Analytics or any third-party analytics or
          advertising service. These per-account counts run only while you&apos;re signed in,
          and are switched off on the home page, the sign-in and sign-up pages, and these legal
          pages. The contents of your trades, notes, and journal entries are never recorded in
          analytics — a button press is recorded by the button&apos;s own label, never by
          anything you typed.
        </p>
        <p className={BODY}>
          Exactly what is recorded, with the time: the pages you open; the buttons you press, by
          their label; when you leave the app or switch away from it, and on which page; signing
          in and creating your account; how far you got in a product tour; and that you created,
          edited, deleted, imported or exported trades, added a cash entry, or used an AI feature
          (with the provider&apos;s name), but never what those trades or entries contain. While
          the app is open, a timer also counts how long you spend in it. Usage events are
          included when you download your data from the Account page.
        </p>
        <p className={BODY}>
          Separately, we keep an anonymous tally of how many times the home page and pricing
          page are viewed each day. That tally is a single number per day. It stores nothing
          about you — no cookie, no identifier, no IP address — and cannot be connected to any
          person or account.
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
          You can download everything we store about your account as one file from the Account
          page: your trades and their edit history, notes, strategies and rules, folders, goals,
          settings, cash entries, fees, AI reviews and conversations, a list of your screenshots
          with download links, and the usage events recorded for your account. Your trades can
          also be exported as CSV, Excel or JSON from the Trades page.
        </p>
        <p className={BODY}>
          You can permanently delete your account and all of its data yourself, from the Account
          page. Deletion can&apos;t be undone. You can also ask us to do it by email (see below).
        </p>

        <h2 className={SECTION_HEADING}>Children&apos;s privacy</h2>
        <p className={BODY}>
          Trading Lens is not directed at, or intended for use by, anyone under 18. Creating an
          account requires confirming that you are 18 or older.
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
