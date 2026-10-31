import type { Metadata } from "next";
import Link from "next/link";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import {
  FREE_TOOL_SECTION,
  FreeToolCta,
  JsonLd,
  SECONDARY_BUTTON,
  SignUpButton,
} from "@/components/landing/free-tools";
import { BASE_OPEN_GRAPH, SITE_NAME, SITE_URL } from "@/lib/site";

// A public guide, here to be found in search ("how to journal swing trades")
// and to lead to the template download and sign-up. Fully server-rendered:
// no client component of its own.
//
// The worked example's numbers are tied together and must move as one:
// entry 50.40, stop 48.00, 41 shares, risk $98.40, target 55.20 (2R), exit
// 54.60, P/L +$172.20, 1.75R. They match the calculator's defaults on
// /position-size-calculator and row 2 of the template
// (scripts/generate-journal-template.ts).

const PATH = "/how-to-journal-a-swing-trade";
const TITLE = "How to Journal a Swing Trade (With a Worked Example) | Trading Lens";
const HEADLINE = "How to journal a swing trade";
const DESCRIPTION =
  "A step-by-step guide to journaling swing trades: what to write before, during and after each trade, with a worked breakout example and a free template.";
const PUBLISHED = "2026-10-31";
const TEMPLATE = "/Swing-Trading-Journal-Template.xlsx";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: {
    ...BASE_OPEN_GRAPH,
    type: "article",
    url: PATH,
    title: TITLE,
    description: DESCRIPTION,
    publishedTime: PUBLISHED,
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: HEADLINE,
  description: DESCRIPTION,
  url: `${SITE_URL}${PATH}`,
  mainEntityOfPage: `${SITE_URL}${PATH}`,
  image: `${SITE_URL}/opengraph-image`,
  datePublished: PUBLISHED,
  dateModified: PUBLISHED,
  author: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
  publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
};

const H2 = "mt-12 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50";
const H3 = "mt-8 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50";
const P = "mt-4 leading-relaxed text-zinc-700 dark:text-zinc-300";
const UL = "mt-4 flex list-disc flex-col gap-2 pl-5 leading-relaxed text-zinc-700 marker:text-zinc-400 dark:text-zinc-300";
const B = "font-semibold text-zinc-900 dark:text-zinc-50";
const A = "font-medium text-primary hover:underline";

/** A two-column field/value table for the worked example. */
function ExampleTable({ caption, rows }: { caption: string; rows: [string, string][] }) {
  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-zinc-200 dark:border-subtle">
      <table className="w-full text-left text-sm">
        <caption className="border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 text-left font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500 dark:border-subtle dark:bg-card">
          {caption}
        </caption>
        <tbody className="divide-y divide-zinc-200 dark:divide-subtle">
          {rows.map(([field, value]) => (
            <tr key={field} className="align-top">
              <th scope="row" className="w-[38%] px-4 py-2.5 font-medium text-zinc-600 dark:text-zinc-400">
                {field}
              </th>
              <td className="px-4 py-2.5 text-zinc-900 tabular-nums dark:text-zinc-100">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function HowToJournalASwingTradePage() {
  return (
    <div data-v2-page="landing" className="flex flex-1 flex-col">
      <JsonLd data={JSON_LD} />
      <LandingHeader />

      <article className={`${FREE_TOOL_SECTION} pt-12 pb-14 sm:pt-16`}>
        <header>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">Guide</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
            How to journal a swing trade
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
            What to write before, during and after each trade, with a worked breakout example and a
            free template you can download at the end.
          </p>
        </header>

        <div className="max-w-2xl">
          <h2 className={H2}>Why journal swing trades at all</h2>
          <p className={P}>
            A swing trade lasts days or weeks. By the time it closes, you have usually forgotten why
            you took it, where you planned to get out, and what you were feeling when you clicked buy.
            Without a written record, the only thing left is the P/L, and the P/L alone can&rsquo;t
            tell a good decision that lost money from a bad decision that got lucky.
          </p>
          <p className={P}>
            A journal fixes that. Write the plan down before the trade, note what changed while it was
            open, and grade it honestly after it closes. After twenty or thirty trades you have real
            data about your own trading: which setups work for you, which mistakes repeat, and whether
            you follow your own rules.
          </p>

          <h2 className={H2}>Before the trade: write the plan</h2>
          <p className={P}>
            This is the most important part, because it&rsquo;s the only part you can&rsquo;t fill in
            honestly afterwards. Before you enter, write down:
          </p>
          <ul className={UL}>
            <li>
              <span className={B}>Ticker and direction.</span> Long or short.
            </li>
            <li>
              <span className={B}>Setup.</span> The pattern or reason in a few words: breakout,
              pullback to the 20-day average, earnings gap. Use the same names every time so you can
              group trades later.
            </li>
            <li>
              <span className={B}>Entry, stop and target.</span> The exact prices. The stop is where
              your idea is proven wrong, not a random percentage.
            </li>
            <li>
              <span className={B}>Position size.</span> Work it out from your risk: account size ×
              risk %, divided by the distance from entry to stop. The free{" "}
              <Link href="/position-size-calculator" className={A}>
                position size calculator
              </Link>{" "}
              does this for you.
            </li>
            <li>
              <span className={B}>Dollar risk (1R).</span> What you lose if the stop is hit. Every
              result gets measured against this number.
            </li>
            <li>
              <span className={B}>Why now.</span> One or two sentences on what you see and what would
              make you wrong.
            </li>
            <li>
              <span className={B}>How you feel.</span> Calm, impatient, chasing a loss, bored. One
              word is enough. It matters more than it seems.
            </li>
          </ul>

          <h2 className={H2}>During the trade: log every change</h2>
          <p className={P}>
            Most swing trades need little attention, which is exactly when undocumented decisions slip
            in. Each time you touch the position, write a line with the date and the reason:
          </p>
          <ul className={UL}>
            <li>Moving the stop, and why. Moving it further away is worth flagging every time.</li>
            <li>Selling part of the position, or adding to it.</li>
            <li>News or earnings that changed the picture.</li>
            <li>Any urge to exit early or hold past your plan, even if you didn&rsquo;t act on it.</li>
          </ul>

          <h2 className={H2}>After the trade: grade it</h2>
          <p className={P}>Once the trade is closed, fill in the result and then judge the decision:</p>
          <ul className={UL}>
            <li>
              <span className={B}>Exit price and date.</span>
            </li>
            <li>
              <span className={B}>P/L in dollars,</span> after commissions if you pay them.
            </li>
            <li>
              <span className={B}>R multiple:</span> P/L divided by your planned dollar risk. +2R
              means you made twice what you risked; −1R means the stop was hit as planned.
            </li>
            <li>
              <span className={B}>Did you follow the plan?</span> Yes or no, for entry, stop, size
              and exit separately. A losing trade that followed the plan is a good trade.
            </li>
            <li>
              <span className={B}>What went right and what went wrong.</span> One sentence each.
            </li>
            <li>
              <span className={B}>One lesson,</span> phrased as something you will do next time.
            </li>
          </ul>

          <h2 className={H2}>A worked example: a breakout trade</h2>
          <p className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm leading-relaxed text-zinc-600 dark:border-subtle dark:bg-card dark:text-zinc-400">
            The ticker and numbers below are made up to show the format. This is not a trade
            recommendation.
          </p>

          <h3 className={H3}>The plan, written before entry</h3>
          <p className={P}>
            The trader has a $10,000 account and risks 1% per trade, so the most they can lose here is
            $100. The stock has spent three weeks in a tight range under $50 and has just closed above
            it on higher volume.
          </p>
          <ExampleTable
            caption="Before the trade"
            rows={[
              ["Ticker", "XYZ (made up)"],
              ["Direction", "Long"],
              ["Setup", "Breakout from a 3-week base"],
              ["Entry", "$50.40"],
              ["Stop", "$48.00, under the base"],
              ["Risk per share (1R)", "$2.40"],
              ["Position size", "41 shares ($100 ÷ $2.40 = 41.67, rounded down)"],
              ["Dollar risk", "$98.40"],
              ["Target", "$55.20 = 2R"],
              ["Why now", "Closed above the range on rising volume. Wrong if it closes back under $48."],
              ["Feeling", "Calm, a little eager after two days of waiting"],
            ]}
          />

          <h3 className={H3}>Notes while the trade was open</h3>
          <ExampleTable
            caption="During the trade"
            rows={[
              ["Day 2", "Pulled back to $49.60. Wanted to sell. Stop not hit, so held."],
              ["Day 4", "Up to $53.90. Left the stop at $48.00 as planned."],
              ["Day 6", "Hit $55.00, then turned lower on a weak market. Sold at $54.60, short of the target."],
            ]}
          />

          <h3 className={H3}>The review, written after exit</h3>
          <ExampleTable
            caption="After the trade"
            rows={[
              ["Exit", "$54.60 on day 6"],
              ["P/L", "+$172.20 (41 × $4.20)"],
              ["R multiple", "+1.75R ($172.20 ÷ $98.40)"],
              ["Followed the plan?", "Entry, stop and size: yes. Exit: no, sold before the $55.20 target."],
              ["What went right", "Sized from the stop, and held through the day-2 pullback."],
              ["What went wrong", "Sold on one red day instead of letting the stop or the target decide."],
              ["Lesson", "If I want to exit before the target, write the reason first, then decide."],
            ]}
          />
          <p className={P}>
            Notice what the review shows that the P/L doesn&rsquo;t. The trade made money, but the
            exit broke the plan. If early exits keep showing up across many trades, that is a pattern
            worth fixing, and you would never see it from the profit number alone.
          </p>

          <h2 className={H2}>Once a week: review the journal</h2>
          <p className={P}>
            Single trades are noise. The value is in the patterns, so set aside time each week to look
            across everything you closed:
          </p>
          <ul className={UL}>
            <li>Total R for the week, and average R per trade.</li>
            <li>Which setups made R and which lost it.</li>
            <li>How often you broke your own rules, and what those trades cost.</li>
            <li>Whether certain feelings (impatient, revenge, bored) come before your worst trades.</li>
          </ul>

          <h2 className={H2}>Common journaling mistakes</h2>
          <ul className={UL}>
            <li>
              <span className={B}>Filling in the plan after the trade.</span> Hindsight rewrites it.
              Write it before you enter.
            </li>
            <li>
              <span className={B}>Logging only the losers,</span> or only the winners. Every trade
              goes in.
            </li>
            <li>
              <span className={B}>Measuring in dollars only.</span> Use R so trades of different
              sizes compare fairly.
            </li>
            <li>
              <span className={B}>Writing essays.</span> A few honest lines per trade beat a page you
              stop writing after a week.
            </li>
          </ul>
        </div>
      </article>

      <FreeToolCta
        heading="Start your swing trading journal"
        actions={
          <>
            <a href={TEMPLATE} download className={SECONDARY_BUTTON}>
              Download the free template
            </a>
            <SignUpButton />
          </>
        }
      >
        <p>
          The spreadsheet template has every column from this guide, with the worked example filled in
          and P/L and R worked out for you. Or use Trading Lens, a free trading journal that works out
          your R multiple and checks each trade against your own rules. No card.
        </p>
      </FreeToolCta>

      <LandingFooter />
    </div>
  );
}
