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
import { breakEvenWinRate } from "@/lib/risk-reward/calculate";
import { RiskRewardCalculator } from "./calculator";

// A free public tool for the search "risk reward calculator". Same shape as
// /position-size-calculator: server-rendered text around one small client
// component, with the math in src/lib/risk-reward/calculate.ts under tests.

const PATH = "/risk-reward-calculator";
const TITLE = "Risk/Reward Ratio Calculator (With Break-Even Win Rate) | Trading Lens";
const DESCRIPTION =
  "Free risk reward calculator for traders. Enter your entry, stop and target to get your reward:risk ratio, break-even win rate and dollar risk. No sign-up.";

export const metadata: Metadata = freeToolMetadata({ path: PATH, title: TITLE, description: DESCRIPTION });

const JSON_LD = webAppJsonLd({ path: PATH, name: "Risk/Reward Ratio Calculator", description: DESCRIPTION });

/** Worked out from the same function the calculator uses, not typed in. */
const TABLE_RATIOS = [0.5, 1, 1.5, 2, 3, 4];

const { h2: H2, p: P, ul: UL, b: B, a: A } = PROSE;

export default function RiskRewardCalculatorPage() {
  return (
    <div data-v2-page="landing" className="flex flex-1 flex-col">
      <JsonLd data={JSON_LD} />
      <LandingHeader />

      <FreeToolHero kicker="Free tool" title="Risk/reward calculator">
        Enter your entry, stop and target. You get the reward-to-risk ratio, the win rate you need to
        break even at it, and how far price has to move each way. Add a share count to see it in
        dollars. Long or short. No sign-up, and nothing you type leaves your browser.
      </FreeToolHero>

      <section className={`${FREE_TOOL_SECTION} pb-6`} aria-label="Calculator">
        <RiskRewardCalculator />
      </section>

      <section className={`${FREE_TOOL_SECTION} pb-14`}>
        <div className="max-w-2xl">
          <h2 className={H2}>Break-even win rate by reward : risk</h2>
          <p className={P}>
            The higher the ratio, the less often you need to be right. These ignore commissions and
            slippage, which push every number up a little.
          </p>
          <div className="mt-5 overflow-hidden rounded-xl border border-zinc-200 dark:border-subtle">
            <table className="w-full text-left text-sm tabular-nums">
              <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-card">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Reward : risk</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Win rate to break even</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-subtle">
                {TABLE_RATIOS.map((rr) => (
                  <tr key={rr}>
                    <td className="px-4 py-2.5 font-medium text-zinc-900 dark:text-zinc-100">{rr} : 1</td>
                    <td className="px-4 py-2.5 text-zinc-700 dark:text-zinc-300">
                      {(breakEvenWinRate(rr) * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className={H2}>How the math works</h2>
          <ul className={UL}>
            <li>
              <span className={B}>Risk per share</span> = the distance from entry to stop. Entry $50.40
              and stop $48.00 risks $2.40 a share.
            </li>
            <li>
              <span className={B}>Reward per share</span> = the distance from entry to target. A
              $55.20 target is worth $4.80 a share.
            </li>
            <li>
              <span className={B}>Reward : risk</span> = reward ÷ risk. $4.80 ÷ $2.40 = 2, written
              2 : 1. The target is worth two of what the stop costs, which is the same as saying the
              target sits at 2R.
            </li>
            <li>
              <span className={B}>Break-even win rate</span> = 1 ÷ (1 + reward : risk). At 2 : 1 that
              is 1 ÷ 3 = 33.3%. Win one trade in three at full target and the wins pay for the
              losses.
            </li>
          </ul>
          <p className={P}>
            For a short trade the stop sits above the entry and the target below it. The math is the
            same with the direction flipped.
          </p>

          <h2 className={H2}>Why the ratio alone isn&rsquo;t enough</h2>
          <p className={P}>
            A 5 : 1 target looks great on paper, but if price almost never gets there, the ratio is
            fiction. A target far away is hit less often, so a higher ratio usually comes with a lower
            win rate. What matters is the pair together: how often you win, and how much you make
            when you do compared with what you lose when you don&rsquo;t.
          </p>
          <p className={P}>
            Two habits make the number honest. Put the stop where the idea is proven wrong and the
            target where price could realistically reach, then let the ratio fall out of those two
            prices, rather than picking a ratio and placing the levels to fit it. And track what you
            actually make in{" "}
            <Link href="/what-is-an-r-multiple" className={A}>
              R multiples
            </Link>
            , because the realised result often differs from the plan: you exit early, or the stop
            slips.
          </p>
          <p className={P}>
            Once you know the risk per share, the{" "}
            <Link href="/position-size-calculator" className={A}>
              position size calculator
            </Link>{" "}
            tells you how many shares to buy so a stopped-out trade loses only what you planned.
          </p>
        </div>
      </section>

      <FreeToolCta heading="See your real reward : risk" actions={<SignUpButton />}>
        <p>
          The plan says 2 : 1. What do your trades actually return? Trading Lens is a free trading
          journal that works out the R multiple of every trade you log and checks it against your own
          rules. Free to use, no card.
        </p>
      </FreeToolCta>

      <MoreFreeTools current={PATH} />
      <LandingFooter />
    </div>
  );
}
