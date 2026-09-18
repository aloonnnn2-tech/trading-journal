import type { Metadata } from "next";
import Link from "next/link";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { PublicViewBeacon } from "@/components/public-view-beacon";

// The long version of the paid plan.
//
// The pricing section already has a two-minute walkthrough modal. This is the
// page for the reader who wants to know exactly what they would be paying for
// before they decide, and it answers three questions per feature rather than
// listing names: what it is, how it works, and how you would actually use it.
//
// **Every entry below maps to a real gate in the code.** /reviews, /reports
// and /ask check isPaidUser and redirect; Find My Edge, the strategy
// scorecards, and the performance, excursion, risk and regime panels render an
// upsell in place of the panel. Nothing here is aspirational, and a feature
// that does not ship does not appear.
//
// No pricing number appears anywhere on this page on purpose: billing is not
// live yet, and a figure printed before it is real is the kind of detail
// people remember being wrong about.

export const metadata: Metadata = {
  title: "What the paid plan does — Trading Lens",
  description:
    "Every paid feature explained: what it is, how it works, and how to use it. The free journal stays complete.",
};

interface Feature {
  name: string;
  where: string;
  what: string;
  how: string;
  use: string;
}

const GROUPS: { group: string; blurb: string; features: Feature[] }[] = [
  {
    group: "Reading your own history",
    blurb:
      "The free plan records what happened. These four read it back and tell you which parts of your trading are carrying the account.",
    features: [
      {
        name: "Find My Edge",
        where: "Insights",
        what: "Every way of cutting your closed trades, ranked by expectancy rather than win rate.",
        how: "Each trade is grouped by setup, instrument, day, holding period, emotion and exit behaviour. Every group is scored on average R and compared against your own overall average, so the ranking is relative to you rather than to some general benchmark. Groups below a minimum sample are held back instead of shown, because a segment built on four trades is noise.",
        use: "Open it after a month or two of trading. Read the leaks before the edges: cutting the worst segment usually moves the curve further than doing more of the best one.",
      },
      {
        name: "MAE / MFE",
        where: "Analysis",
        what: "How far each trade went against you after entry, and how far it ran in your favour before you closed it.",
        how: "Prices between your entry and exit are measured to find the worst and best points the trade reached, then expressed both as a percentage and in R. The capture figure is the share of the favourable move you actually kept.",
        use: "A high adverse excursion on trades that still won means your stop is sitting further away than it needs to. A low capture rate means you are leaving the back half of your moves behind.",
      },
      {
        name: "Strategy scorecards",
        where: "Strategies",
        what: "Each strategy scored on its own, side by side.",
        how: "Trades are grouped by the strategy they are tagged with, then scored on the same measures the rest of the app uses, so the numbers agree with what you see elsewhere.",
        use: "Run it when you are deciding which setup to drop. It answers which strategy is worth the screen time, rather than which one you enjoy trading.",
      },
      {
        name: "Risk, regime and performance panels",
        where: "Analysis",
        what: "Three deeper reads: how much you risk and when, how you do in different market conditions, and how performance moves over time.",
        how: "All three are built from the same stats engine the free analytics use, so a figure here never disagrees with a figure there.",
        use: "These are the monthly-review panels rather than the daily ones. Most people open them once a month, not once a session.",
      },
    ],
  },
  {
    group: "AI that runs on your key",
    blurb:
      "Every AI feature uses an API key you provide. The app never holds a usable key of its own, which is worth understanding before you decide how you feel about AI touching your trading data.",
    features: [
      {
        name: "AI trade review",
        where: "Reviews",
        what: "Any closed trade scored on how you traded it rather than on whether it won.",
        how: "The trade, your plan rules and your own history are sent to the provider you configured. The score separates execution from outcome, so a winner you fumbled can still come back marked down, and a loss where you followed your plan exactly does not.",
        use: "Review the trades that felt worst, not the ones that lost most. Those are usually different trades, and the gap between them is the useful part.",
      },
      {
        name: "AI period review",
        where: "Reviews",
        what: "Your week or month summarised: the biggest edge, the biggest leak, and three priorities.",
        how: "The period's trades and your own statistics are summarised and sent to your provider, which returns a written read rather than another table.",
        use: "Run it on a Friday. It is the fastest way to end a week with a short list of what to change instead of a vague sense that something is off.",
      },
      {
        name: "Ask",
        where: "AI",
        what: "A question box over your own journal.",
        how: "Your question and the relevant slice of your trading data go to your configured provider. Bring a key from any supported provider; free tiers are usually enough.",
        use: "Best for questions a table cannot answer in one look, such as how a setup behaves when you are already down on the day.",
      },
    ],
  },
  {
    group: "Taking it with you",
    blurb: "For the parts of reviewing that happen away from the screen.",
    features: [
      {
        name: "Printable reports",
        where: "Reports",
        what: "Your month as a document, laid out to print.",
        how: "The report is rendered as a real page with print styles, so your browser's Save as PDF produces something readable rather than a screenshot of an app.",
        use: "Useful if you review on paper, keep records for tax, or send a monthly summary to someone who coaches you.",
      },
    ],
  },
];

export default function PaidPlanPage() {
  return (
    <div data-v2-page="landing" className="flex flex-1 flex-col">
      <PublicViewBeacon path="/paid-plan" />
      <LandingHeader />

      <section className="mx-auto w-full max-w-4xl px-6 pt-16 pb-10 sm:px-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
          The paid plan, in full
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
          What you would be paying for
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
          Every paid feature below, with what it is, how it works, and how you would use it. The
          free journal stays complete either way: nothing you rely on today moves behind this.
        </p>
        <p className="mt-3 max-w-2xl text-sm text-zinc-500">
          Billing is not live yet, so there is no price here to quote.
        </p>
      </section>

      {GROUPS.map((group) => (
        <section key={group.group} className="mx-auto w-full max-w-4xl px-6 pb-12 sm:px-10">
          <div className="border-t border-zinc-200 pt-10 dark:border-subtle">
            <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {group.group}
            </h2>
            <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-400">{group.blurb}</p>

            <div className="mt-8 flex flex-col gap-8">
              {group.features.map((f) => (
                <article
                  key={f.name}
                  className="rounded-xl border border-zinc-200 p-6 dark:border-subtle sm:p-7"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                      {f.name}
                    </h3>
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
                      Found under {f.where}
                    </span>
                  </div>

                  <p className="mt-3 text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300">
                    {f.what}
                  </p>

                  {/* A definition list rather than three more paragraphs: the
                      reader is scanning for one of these three answers, and
                      labelling them is what makes that possible. */}
                  <dl className="mt-5 flex flex-col gap-4 border-t border-zinc-200 pt-5 dark:border-subtle">
                    <div>
                      <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
                        How it works
                      </dt>
                      <dd className="mt-1.5 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                        {f.how}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
                        How to use it
                      </dt>
                      <dd className="mt-1.5 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                        {f.use}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </div>
        </section>
      ))}

      <section className="mx-auto w-full max-w-4xl px-6 pb-24 sm:px-10">
        <div className="border-t border-zinc-200 pt-10 dark:border-subtle">
          <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            What stays free
          </h2>
          <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-400">
            Unlimited trades, the equity curve and drawdown, win rate, profit factor and
            expectancy, trading rules with automatic mistake tracking, goals, imports and exports,
            and full version history. It is a complete journal rather than a trial, and nothing in
            it expires.
          </p>
          <Link
            href="/sign-up"
            className="mt-6 inline-block rounded-lg bg-primary px-6 py-3 font-medium text-white transition hover:brightness-110 dark:text-zinc-950"
          >
            Start journaling free
          </Link>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}
