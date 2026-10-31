import type { Metadata } from "next";
import Link from "next/link";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { FREE_TOOL_SECTION, FreeToolCta, JsonLd, SignUpButton } from "@/components/landing/free-tools";
import { BASE_OPEN_GRAPH, SITE_NAME, SITE_URL } from "@/lib/site";
import { PositionSizeCalculator } from "./calculator";

// A free public tool, here to be found in search ("position size
// calculator") and to lead to sign-up. Public for everyone: it is in
// PUBLIC_PATHS and never redirects a signed-in visitor, unlike "/".
//
// Everything but the calculator itself is server-rendered text. The math is
// in src/lib/position-size/calculate.ts, under its own tests.

const PATH = "/position-size-calculator";
const TITLE = "Position Size & R-Multiple Calculator for Swing Traders | Trading Lens";
const DESCRIPTION =
  "Free position size calculator. Enter your account size, risk %, entry and stop to get the number of shares, your 1R, and 1R/2R/3R targets. No sign-up.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: { ...BASE_OPEN_GRAPH, url: PATH, title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Position Size & R-Multiple Calculator",
  url: `${SITE_URL}${PATH}`,
  description: DESCRIPTION,
  applicationCategory: "FinanceApplication",
  operatingSystem: "Any",
  browserRequirements: "Requires JavaScript",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
};

const H2 = "text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50";
const P = "mt-3 leading-relaxed text-zinc-700 dark:text-zinc-300";

export default function PositionSizeCalculatorPage() {
  return (
    <div data-v2-page="landing" className="flex flex-1 flex-col">
      <JsonLd data={JSON_LD} />
      <LandingHeader />

      <section className={`${FREE_TOOL_SECTION} pt-12 pb-8 sm:pt-16`}>
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">Free tool</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
          Position size calculator
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
          Enter your account size, how much of it you will risk, and your entry and stop. You get the
          number of shares to buy, what one R is worth in dollars, and where your 1R, 2R and 3R
          targets sit. Long or short. No sign-up, and nothing you type leaves your browser.
        </p>
      </section>

      <section className={`${FREE_TOOL_SECTION} pb-14`} aria-label="Calculator">
        <PositionSizeCalculator />
      </section>

      <section className={`${FREE_TOOL_SECTION} pb-12`}>
        <div className="border-t border-zinc-200 pt-10 dark:border-subtle">
          <h2 className={H2}>How the math works</h2>
          <p className={P}>
            The calculator starts from the most you are willing to lose, not from how much you want
            to buy. Every number follows from four steps:
          </p>
          <ol className="mt-4 flex list-decimal flex-col gap-3 pl-5 leading-relaxed text-zinc-700 marker:text-zinc-500 dark:text-zinc-300">
            <li>
              <strong className="font-semibold text-zinc-900 dark:text-zinc-50">Max risk</strong> =
              account size × risk %. With $10,000 and 1%, you can lose $100 on this trade.
            </li>
            <li>
              <strong className="font-semibold text-zinc-900 dark:text-zinc-50">Risk per share (1R)</strong>{" "}
              = the distance from entry to stop. Entry $50.40 and stop $48.00 means each share loses
              $2.40 if the stop is hit. That $2.40 is one R.
            </li>
            <li>
              <strong className="font-semibold text-zinc-900 dark:text-zinc-50">Shares</strong> = max
              risk ÷ risk per share, rounded down. $100 ÷ $2.40 = 41.67, so 41 shares. Rounding down
              keeps the real risk at or under your limit: 41 × $2.40 = $98.40.
            </li>
            <li>
              <strong className="font-semibold text-zinc-900 dark:text-zinc-50">Targets</strong> sit at
              whole multiples of R from the entry. 1R is $52.80, 2R is $55.20 and 3R is $57.60. A
              target of $55.20 is a 2 : 1 reward to risk, worth $196.80 on 41 shares.
            </li>
          </ol>
          <p className={P}>
            For a short trade the stop sits above the entry and the targets sit below it. The math is
            the same with the direction flipped.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-zinc-500">
            The calculator ignores commissions, fees and slippage. A gap through your stop can lose
            more than one R.
          </p>
        </div>
      </section>

      <section className={`${FREE_TOOL_SECTION} pb-14`}>
        <div className="border-t border-zinc-200 pt-10 dark:border-subtle">
          <h2 className={H2}>Why traders size by risk</h2>
          <p className={P}>
            Buying a fixed dollar amount or a round number of shares means every trade risks a
            different amount. A tight stop and a wide stop on the same $5,000 position can be a $50
            loss or a $500 loss. Sizing by risk fixes the loss instead, so the stop decides the share
            count, not the other way round.
          </p>
          <p className={P}>
            That keeps one bad trade from undoing several good ones. It also puts every result in the
            same unit. A win of +2R means the same thing on a $20 stock and on a $400 one, so you can
            compare trades, setups and months honestly.
          </p>
          <p className={P}>
            Many swing traders risk somewhere around 0.5% to 2% of the account per trade. The right
            number depends on your strategy and how much drawdown you can sit through. Pick a number
            you could live with if you lost it ten times in a row.
          </p>
          <p className={P}>
            Want to record trades with this structure? Read{" "}
            <Link href="/how-to-journal-a-swing-trade" className="font-medium text-primary hover:underline">
              how to journal a swing trade
            </Link>
            , with a worked example and a free template.
          </p>
        </div>
      </section>

      <FreeToolCta heading="Track every trade in R" actions={<SignUpButton />}>
        <p>
          Trading Lens is a free trading journal. Log your entry, stop and exit, and it works out your
          R multiple and checks each trade against your own rules. Free to use, no card.
        </p>
      </FreeToolCta>

      <LandingFooter />
    </div>
  );
}
