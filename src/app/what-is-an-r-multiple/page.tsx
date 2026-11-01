import type { Metadata } from "next";
import Link from "next/link";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import {
  articleJsonLd,
  FREE_TOOL_SECTION,
  FreeToolCta,
  FreeToolHero,
  freeToolMetadata,
  JsonLd,
  MoreFreeTools,
  PROSE,
  SignUpButton,
} from "@/components/landing/free-tools";
import { RConverter } from "./converter";

// A free public explainer for the search "r multiple trading". The worked
// numbers are the journal guide's trade ($98.40 risk, +$172.20 = +1.75R), so
// the free pages all describe the same example.

const PATH = "/what-is-an-r-multiple";
const PUBLISHED = "2026-11-01";
const TITLE = "What Is an R Multiple in Trading? (With Examples) | Trading Lens";
const HEADLINE = "What is an R multiple?";
const DESCRIPTION =
  "An R multiple measures a trade's result in units of the risk you took. Learn the formula, see worked examples, and use R to compare trades fairly.";

export const metadata: Metadata = freeToolMetadata({
  path: PATH,
  title: TITLE,
  description: DESCRIPTION,
  article: { published: PUBLISHED },
});

const JSON_LD = articleJsonLd({ path: PATH, headline: HEADLINE, description: DESCRIPTION, published: PUBLISHED });

const { h2: H2, p: P, ul: UL, b: B, a: A } = PROSE;

/** Every row is a multiple of the same $98.40 risk, so each R is exact. */
const EXAMPLES: [string, string, string][] = [
  ["Hit the target at 2R", "+$196.80", "+2R"],
  ["Sold early, short of the target", "+$172.20", "+1.75R"],
  ["Closed near break-even", "+$24.60", "+0.25R"],
  ["Stopped out as planned", "−$98.40", "−1R"],
  ["Gapped through the stop", "−$147.60", "−1.5R"],
];

export default function WhatIsAnRMultiplePage() {
  return (
    <div data-v2-page="landing" className="flex flex-1 flex-col">
      <JsonLd data={JSON_LD} />
      <LandingHeader />

      <FreeToolHero kicker="Guide" title="What is an R multiple?">
        An R multiple measures a trade&rsquo;s result in units of the risk you took on it. It turns
        &ldquo;I made $172&rdquo; into &ldquo;I made 1.75 times what I risked&rdquo;, which is the
        number that actually tells you whether your trading works.
      </FreeToolHero>

      <article className={`${FREE_TOOL_SECTION} pb-14`}>
        <div className="max-w-2xl">
          <h2 className={H2.replace("mt-12 ", "")}>R is your risk on the trade</h2>
          <p className={P}>
            <span className={B}>R</span> is the amount you planned to lose if the trade hit its stop.
            Buy 41 shares at $50.40 with a stop at $48.00 and each share risks $2.40, so R = 41 ×
            $2.40 = <span className={B}>$98.40</span>.
          </p>
          <p className={P}>
            The <span className={B}>R multiple</span> is the result divided by R:
          </p>
          <p className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-4 text-center font-mono text-sm text-zinc-900 dark:border-subtle dark:bg-card dark:text-zinc-100 sm:text-base">
            R multiple = profit or loss ÷ planned risk
          </p>
          <p className={P}>
            Sell those 41 shares at $54.60 for a $172.20 profit, and the trade made $172.20 ÷ $98.40 ={" "}
            <span className={B}>+1.75R</span>.
          </p>

          <div className="mt-8">
            <RConverter />
          </div>

          <h2 className={H2}>Examples on the same trade</h2>
          <p className={P}>
            The same setup with $98.40 at risk, ending five different ways. The numbers are made up to
            show the math.
          </p>
          <div className="mt-5 overflow-hidden rounded-xl border border-zinc-200 dark:border-subtle">
            <table className="w-full text-left text-sm tabular-nums">
              <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-card">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Outcome</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">P/L</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">R</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-subtle">
                {EXAMPLES.map(([outcome, pl, r]) => (
                  <tr key={outcome}>
                    <th scope="row" className="px-4 py-2.5 font-medium text-zinc-700 dark:text-zinc-300">
                      {outcome}
                    </th>
                    <td className="px-4 py-2.5 text-right text-zinc-900 dark:text-zinc-100">{pl}</td>
                    <td
                      className={`px-4 py-2.5 text-right font-semibold ${r.startsWith("−") ? "text-loss" : "text-profit"}`}
                    >
                      {r}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={P}>
            A full stop-out is always −1R. Anything worse than −1R means the loss got bigger than
            planned, usually from a gap or a stop you moved, and it&rsquo;s worth a note in your
            journal.
          </p>

          <h2 className={H2}>Why R beats dollars and percentages</h2>
          <ul className={UL}>
            <li>
              <span className={B}>It compares trades of any size.</span> A $300 win on a trade that
              risked $600 is +0.5R. A $150 win on a trade that risked $50 is +3R. In dollars the first
              looks better; in R it&rsquo;s clearly the weaker trade.
            </li>
            <li>
              <span className={B}>It survives account growth.</span> As your account and position
              sizes grow, dollar results grow too, but a +2R trade means the same thing at any size.
            </li>
            <li>
              <span className={B}>It ties the result to the decision.</span> R is set by your stop and
              size before entry, so it measures how well the trade paid for the risk you chose.
            </li>
          </ul>

          <h2 className={H2}>Average R and expectancy</h2>
          <p className={P}>
            Add up the R of all your trades and divide by the number of trades and you get your{" "}
            <span className={B}>average R per trade</span>, also called expectancy in R. It answers
            the question that matters: on average, how much does one trade make for each unit you
            risk?
          </p>
          <p className={P}>
            Say you take ten trades: four reach +2R (+8R in total) and six are stopped out at −1R (−6R
            in total). That&rsquo;s +2R over ten trades, or <span className={B}>+0.2R per trade</span>,
            even though you lost more often than you won. Risking $100 per trade, that is $20 a trade
            on average. The{" "}
            <Link href="/risk-reward-calculator" className={A}>
              risk/reward calculator
            </Link>{" "}
            shows why: at 2 : 1 you only need to win a third of your trades to break even.
          </p>

          <h2 className={H2}>Common mistakes with R</h2>
          <ul className={UL}>
            <li>
              <span className={B}>Using the moved stop.</span> R is fixed by the stop at entry. If you
              later move the stop, keep measuring against the original risk, or every number gets
              flattered.
            </li>
            <li>
              <span className={B}>Trading without a stop.</span> No stop means no defined risk, and no
              R. Those trades can&rsquo;t be compared with anything.
            </li>
            <li>
              <span className={B}>Forgetting costs.</span> Commissions and fees come out of the
              result, so a trade that &ldquo;made 1R&rdquo; before costs made a little less.
            </li>
          </ul>
          <p className={P}>
            To size a trade so that one R is the amount you want, use the{" "}
            <Link href="/position-size-calculator" className={A}>
              position size calculator
            </Link>
            . To record R on every trade, see{" "}
            <Link href="/how-to-journal-a-swing-trade" className={A}>
              how to journal a swing trade
            </Link>
            .
          </p>
        </div>
      </article>

      <FreeToolCta heading="Get your R multiple on every trade, automatically" actions={<SignUpButton />}>
        <p>
          Trading Lens is a free trading journal. Log your entry, stop, size and exit, and it works out
          the R multiple of every trade for you. Free to use, no card.
        </p>
      </FreeToolCta>

      <MoreFreeTools current={PATH} />
      <LandingFooter />
    </div>
  );
}
