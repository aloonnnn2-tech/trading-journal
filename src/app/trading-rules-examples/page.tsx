import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { CopyButton } from "@/components/landing/copy-button";
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
import { RULE_GROUPS, rulesAsText } from "@/lib/free-tools/trading-rules";

// A free public guide for the search "trading rules examples". The rules are
// data (src/lib/free-tools/trading-rules.ts); the "checks this
// automatically" badge comes from there too, and is held true by a test.

const PATH = "/trading-rules-examples";
const PUBLISHED = "2026-11-01";
const RULE_COUNT = RULE_GROUPS.reduce((n, g) => n + g.rules.length, 0);
const TITLE = `Trading Rules Examples: ${RULE_COUNT} Rules for Swing Traders | Trading Lens`;
const HEADLINE = "Trading rules examples";
const DESCRIPTION =
  "Example trading rules for risk, entries, exits, position management and mindset, each with why it matters. Copy them into your own trading plan.";

export const metadata: Metadata = freeToolMetadata({
  path: PATH,
  title: TITLE,
  description: DESCRIPTION,
  article: { published: PUBLISHED },
});

const JSON_LD = articleJsonLd({ path: PATH, headline: HEADLINE, description: DESCRIPTION, published: PUBLISHED });

const { h2: H2, p: P, ul: UL, b: B, a: A } = PROSE;

export default function TradingRulesExamplesPage() {
  return (
    <div data-v2-page="landing" className="flex flex-1 flex-col">
      <JsonLd data={JSON_LD} />
      <LandingHeader />

      <FreeToolHero kicker="Guide" title="Trading rules examples">
        {RULE_COUNT} example rules for swing traders, grouped by risk, entries, exits, position
        management, routine and mindset. Each one says why it matters. Copy the ones that fit how you
        trade, change the numbers to yours, and you have the start of a written plan.
      </FreeToolHero>

      <section className={`${FREE_TOOL_SECTION} pb-6`}>
        <div className="max-w-2xl">
          <h2 className={H2.replace("mt-12 ", "")}>What makes a good trading rule</h2>
          <ul className={UL}>
            <li>
              <span className={B}>Specific.</span> &ldquo;Risk 1% per trade&rdquo; can be followed or
              broken. &ldquo;Manage risk well&rdquo; can&rsquo;t.
            </li>
            <li>
              <span className={B}>Checkable after the fact.</span> If you can&rsquo;t look at a
              finished trade and say whether you followed it, it&rsquo;s a wish, not a rule.
            </li>
            <li>
              <span className={B}>Decided in advance.</span> Rules exist for the moment when the
              screen is moving and you want to do something else.
            </li>
            <li>
              <span className={B}>Few enough to remember.</span> Ten rules you follow beat forty you
              skim. Start small and add a rule when a mistake repeats.
            </li>
          </ul>
          <p className="mt-6 flex items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm leading-relaxed text-zinc-600 dark:border-subtle dark:bg-card dark:text-zinc-400">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span>
              Rules marked <span className={B}>Trading Lens checks this</span> can be added to Trading
              Lens, which then checks every trade you log against them. The numbers are examples:
              set them to your own account.
            </span>
          </p>
          <div className="mt-6">
            <CopyButton text={rulesAsText()} label={`Copy all ${RULE_COUNT} rules`} />
          </div>
        </div>
      </section>

      {RULE_GROUPS.map((group) => (
        <section key={group.id} className={`${FREE_TOOL_SECTION} pb-4`} aria-labelledby={`rules-${group.id}`}>
          <div className="max-w-2xl">
            <h2 id={`rules-${group.id}`} className={H2}>
              {group.heading}
            </h2>
            <p className={P}>{group.intro}</p>
            <ol className="mt-5 flex flex-col gap-3">
              {group.rules.map((rule) => (
                <li
                  key={rule.text}
                  className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-subtle dark:bg-card"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium leading-snug text-zinc-900 dark:text-zinc-50">{rule.text}</p>
                    <CopyButton text={rule.text} />
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{rule.why}</p>
                  {rule.checksWith && (
                    // primary-hover in light mode: plain primary on this tint is 4.48:1, just under AA.
                    <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary-hover dark:text-primary">
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                      Trading Lens checks this
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </section>
      ))}

      <section className={`${FREE_TOOL_SECTION} pb-14`}>
        <div className="max-w-2xl">
          <h2 className={H2}>How to turn these into your rules</h2>
          <ul className={UL}>
            <li>Pick five to ten, mostly from risk and exits. Those protect the account.</li>
            <li>Replace every number with yours: your risk %, your dollar cap, your holding period.</li>
            <li>
              Write them into a{" "}
              <Link href="/trading-plan-template" className={A}>
                trading plan
              </Link>{" "}
              and keep the{" "}
              <Link href="/trading-checklist" className={A}>
                pre-trade checklist
              </Link>{" "}
              next to your screen.
            </li>
            <li>
              After each trade, mark which rules you followed. After a month, the broken ones show you
              exactly what to work on.
            </li>
          </ul>
        </div>
      </section>

      <FreeToolCta heading="Have every trade checked against your rules" actions={<SignUpButton />}>
        <p>
          Trading Lens is a free trading journal. Write your rules once and it checks each trade you
          log against them, so broken rules show up on their own. Free to use, no card.
        </p>
      </FreeToolCta>

      <MoreFreeTools current={PATH} />
      <LandingFooter />
    </div>
  );
}
