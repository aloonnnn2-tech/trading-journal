import type { Metadata } from "next";
import Link from "next/link";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { PublicViewBeacon } from "@/components/public-view-beacon";
import { PAID_GROUPS } from "@/lib/plans/paid-features";

// The long version of the paid plan.
//
// The pricing section already has a two-minute walkthrough modal. This is the
// page for the reader who wants to know exactly what they would be paying for
// before they decide, and it answers three questions per feature rather than
// listing names: what it is, how it works, and how you would actually use it.
//
// The features themselves, and the rules for listing one, live in
// src/lib/plans/paid-features.ts (shared with the in-app Plans panel).

export const metadata: Metadata = {
  title: "What the paid plan does — Trading Lens",
  description:
    "Every paid feature explained: what it is, how it works, and how to use it. The free journal stays complete.",
};

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

      {PAID_GROUPS.map((group) => (
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
            and edit history on every trade. It is a complete journal rather than a trial, and nothing in
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
