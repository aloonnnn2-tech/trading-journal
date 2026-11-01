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
import { PLAN_SECTIONS } from "@/lib/free-tools/trading-plan";
import { TradingPlanBuilder } from "./builder";

// A free public tool for the search "trading plan template". The fields and
// text format are src/lib/free-tools/trading-plan.ts, under tests. The page's
// own copy below the builder is server-rendered, so a crawler reads what a
// trading plan contains even though the builder starts empty.

const PATH = "/trading-plan-template";
const TITLE = "Free Trading Plan Template (Fill In, Print or Copy) | Trading Lens";
const DESCRIPTION =
  "A free trading plan template. Fill in your markets, setups, risk, entry and exit rules and routine, then print it or copy it. No sign-up, nothing saved.";

export const metadata: Metadata = freeToolMetadata({ path: PATH, title: TITLE, description: DESCRIPTION });

const JSON_LD = webAppJsonLd({
  path: PATH,
  name: "Trading Plan Template",
  description: DESCRIPTION,
  category: "BusinessApplication",
});

const { h2: H2, p: P, ul: UL, b: B, a: A } = PROSE;

export default function TradingPlanTemplatePage() {
  return (
    <div data-v2-page="landing" className="flex flex-1 flex-col print:bg-white">
      <JsonLd data={JSON_LD} />
      <LandingHeader />

      <FreeToolHero kicker="Free template" title="Trading plan template">
        Answer a few questions about what you trade, how much you risk and the rules you follow, and
        get a clean one-page trading plan to print, save as a PDF or copy into your notes. Start from
        the example if a blank page is hard. No sign-up.
      </FreeToolHero>

      <section className={`${FREE_TOOL_SECTION} pb-6`} aria-label="Trading plan builder">
        <TradingPlanBuilder />
      </section>

      <section className={`${FREE_TOOL_SECTION} pb-14 print:hidden`}>
        <div className="max-w-2xl">
          <h2 className={H2}>What goes in a trading plan</h2>
          <p className={P}>
            A trading plan is the set of decisions you make once, calmly, so you don&rsquo;t have to
            make them in the middle of a trade. This template covers the parts most plans need:
          </p>
          <ul className={UL}>
            {PLAN_SECTIONS.map((section) => (
              <li key={section.heading}>
                <span className={B}>{section.heading}:</span>{" "}
                {section.fields.map((f) => f.label.toLowerCase()).join(", ")}.
              </li>
            ))}
          </ul>

          <h2 className={H2}>Tips for a plan you&rsquo;ll actually follow</h2>
          <ul className={UL}>
            <li>
              <span className={B}>Keep it to one page.</span> If it&rsquo;s too long to reread before
              the open, it won&rsquo;t get reread.
            </li>
            <li>
              <span className={B}>Use numbers.</span> &ldquo;1% per trade&rdquo; and &ldquo;stop at
              −3R for the day&rdquo; can be followed. &ldquo;Be careful&rdquo; can&rsquo;t.
            </li>
            <li>
              <span className={B}>Change it on weekends, not mid-trade.</span> Edit the plan during
              your weekly review, based on what your journal shows.
            </li>
            <li>
              <span className={B}>Pair it with a checklist.</span> The plan holds the rules; the{" "}
              <Link href="/trading-checklist" className={A}>
                pre-trade checklist
              </Link>{" "}
              is how you apply them before each entry.
            </li>
          </ul>
          <p className={P}>
            Need ideas for the rules sections? Browse{" "}
            <Link href="/trading-rules-examples" className={A}>
              trading rules examples
            </Link>
            , and work out your risk numbers with the{" "}
            <Link href="/position-size-calculator" className={A}>
              position size calculator
            </Link>
            .
          </p>
        </div>
      </section>

      <FreeToolCta heading="Check every trade against your plan" actions={<SignUpButton />}>
        <p>
          A plan only helps if you follow it. Trading Lens is a free trading journal: add your rules
          and it checks each trade you log against them, so you can see where you drift from the plan.
          Free to use, no card.
        </p>
      </FreeToolCta>

      <MoreFreeTools current={PATH} />
      <LandingFooter />
    </div>
  );
}
