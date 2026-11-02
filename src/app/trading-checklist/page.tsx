import type { Metadata } from "next";
import Link from "next/link";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import {
  FREE_TOOL_SECTION,
  FreeToolCta,
  FreeToolHero,
  freeToolMetadata,
  JsonLd,
  MoreFreeTools,
  PROSE,
  SignUpButton,
  webAppJsonLd,
} from "@/components/landing/free-tools";
import { CHECKLIST_COUNT } from "@/lib/free-tools/checklist";
import { TradingChecklist } from "./checklist";

// A free public tool for the searches "trading checklist" and "pre-trade
// checklist". The questions are data (src/lib/free-tools/checklist.ts); the
// checklist renders on the server with every box empty, so the full list is
// in the HTML a crawler reads.

const PATH = "/trading-checklist";
const TITLE = "Pre-Trade Checklist for Swing Traders (Free & Printable) | Trading Lens";
const DESCRIPTION = `A free pre-trade checklist: ${CHECKLIST_COUNT} questions on setup, risk, size and mindset to answer before every entry. Tick them off online or print it.`;

export const metadata: Metadata = freeToolMetadata({ path: PATH, title: TITLE, description: DESCRIPTION });

const JSON_LD = webAppJsonLd({ path: PATH, name: "Pre-Trade Checklist", description: DESCRIPTION });

const { h2: H2, p: P, ul: UL, a: A } = PROSE;

export default function TradingChecklistPage() {
  return (
    <div data-v2-page="landing" className="flex flex-1 flex-col print:bg-white">
      <JsonLd data={JSON_LD} />
      <LandingHeader />

      <FreeToolHero kicker="Free checklist" title="Pre-trade checklist">
        {CHECKLIST_COUNT} questions to run through before every entry. If you can&rsquo;t tick a box,
        that&rsquo;s your reason to wait. Use it here or print it and keep it next to your screen.
        Nothing you tick is saved or sent.
      </FreeToolHero>

      <section className={`${FREE_TOOL_SECTION} pb-6`} aria-label="Checklist">
        <div className="max-w-2xl">
          <TradingChecklist />
        </div>
      </section>

      <section className={`${FREE_TOOL_SECTION} pb-14 print:hidden`}>
        <div className="max-w-2xl">
          <h2 className={H2}>Why use a checklist</h2>
          <p className={P}>
            Most trading mistakes aren&rsquo;t new. They&rsquo;re the same few slips, made again when
            the screen is moving: no stop, size picked by feel, a trade taken to win back the last one.
            A checklist puts the questions in front of you before the order instead of in the review
            after it.
          </p>
          <p className={P}>
            It also slows you down by about a minute, which is often exactly enough to skip the trade
            you would have regretted.
          </p>

          <h2 className={H2}>How to make it your own</h2>
          <ul className={UL}>
            <li>Add a line for each mistake you catch yourself repeating in your journal.</li>
            <li>Remove anything you never fail. A checklist you skim stops working.</li>
            <li>
              Put your numbers in: your minimum reward : risk, your risk %, your daily loss limit. The{" "}
              <Link href="/risk-reward-calculator" className={A}>
                risk/reward calculator
              </Link>{" "}
              and{" "}
              <Link href="/position-size-calculator" className={A}>
                position size calculator
              </Link>{" "}
              give you both in seconds.
            </li>
            <li>
              Write the full set into your{" "}
              <Link href="/trading-plan-template" className={A}>
                trading plan
              </Link>
              , and see{" "}
              <Link href="/trading-rules-examples" className={A}>
                trading rules examples
              </Link>{" "}
              for ideas.
            </li>
          </ul>
        </div>
      </section>

      <FreeToolCta heading="Find out which boxes you skip" actions={<SignUpButton />}>
        <p>
          Trading Lens is a free trading journal that checks every trade you log against your own
          rules, so you can see which ones you break and what it costs you. Free to use, no card.
        </p>
      </FreeToolCta>

      <MoreFreeTools current={PATH} />
      <LandingFooter />
    </div>
  );
}
