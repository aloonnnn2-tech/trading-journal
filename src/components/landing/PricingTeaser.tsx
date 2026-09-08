"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Construction, Sparkles } from "lucide-react";
import { PaidPlanModal } from "./PaidPlanModal";

// The pricing section.
//
// **The paid card is the hero; the free card sits beside it, deliberately
// small.** Two equal columns gave the eye nowhere to land, and a comparison is
// won by whichever side actually gets read. Here the paid card is roughly
// twice the width, carries the bigger heading, the wash and the only filled
// button, so there is one obvious place to start and one obvious next action.
//
// The free plan is not buried for it: it is the only thing anyone can get
// today, so it stays right there, complete and legible -- just quiet. A
// pricing section that hides its free tier to push a paid one reads as a
// trick, and this one cannot even take money yet.
//
// **The card is a teaser, not a list.** Its whole job is to earn one click on
// "See what's inside" -- the real explanation lives in PaidPlanModal, one idea
// per screen, where it gets the reader's full attention instead of competing
// with the rest of the page.
//
// **Every feature named anywhere in this flow is one `isPaidUser` actually
// gates.** Free, and must never appear as paid: plan rules, the mistake
// tracker, suggested tags, goals, the trade timeline. Someone who upgrades for
// something they already had is a refund and a bad review.

const FREE_FEATURES = [
  "Unlimited trades",
  "Equity curve & drawdown",
  "Win rate, profit factor, expectancy",
  "Trading rules & mistake tracking",
  "Goals, imports, exports",
  "Full version history",
];

// Short enough to read at a glance, specific enough to be worth a click.
const TEASERS = [
  "Every trade graded on how you traded it, not on whether it won",
  "Which of your setups is actually carrying the rest",
  "How much of each move you captured, and what you gave back",
];

export function PricingTeaser() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <section id="pricing" className="mx-auto w-full max-w-7xl scroll-mt-20 px-6 pb-24 sm:px-10">
        {/* Centred as a pair, and stacked on a phone -- where "beside it"
            stops being possible and the paid card simply comes first. */}
        <div className="flex flex-col items-center justify-center gap-5 lg:flex-row lg:items-center">
          {/* An empty column the same width as the free card, so the paid card
              lands on the page's true centre line rather than being shoved
              left by its neighbour. Pure whitespace -- it reads as breathing
              room, and without it "centred" was off by about 150px.
              
              Only from xl up, because it costs a full card's width: below that
              there is not enough room for spacer + card + card, and forcing it
              pushed the free card clean off the section. */}
          <div aria-hidden className="hidden xl:block xl:w-56 xl:shrink-0" />
          {/* ---- The paid plan: roughly twice the width, and the hero ----- */}
          <div className="relative w-full max-w-2xl shrink-0 overflow-hidden rounded-2xl border border-primary/40 bg-white p-8 shadow-lg shadow-primary/5 dark:bg-card sm:p-10">
            {/* A quiet wash behind the top of the card, so the eye lands here
                first on a section that also contains a free option. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 -top-32 h-64 bg-[radial-gradient(ellipse_at_top,color-mix(in_srgb,var(--color-primary)_20%,transparent),transparent_70%)]"
            />

            <div className="relative flex items-center justify-center gap-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary">Paid</p>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400">
                <Construction className="h-3 w-3" strokeWidth={2} />
                Under construction
              </span>
            </div>

            {/* The headline is the reader's problem, not our product. */}
            <h3 className="relative mx-auto mt-4 max-w-lg text-center text-2xl font-semibold leading-[1.15] tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-[34px]">
              Your journal already knows why you lose money.
            </h3>
            <p className="relative mx-auto mt-3 max-w-md text-center text-base text-zinc-500 sm:text-lg">
              The free plan keeps the record. This is the part that reads it back to you.
            </p>

            <ul className="relative mx-auto mt-7 max-w-lg space-y-2.5 text-sm text-zinc-600 dark:text-zinc-400 sm:text-base">
              {TEASERS.map((t) => (
                <li key={t} className="flex items-start gap-2.5">
                  <Sparkles className="mt-1 h-4 w-4 shrink-0 text-primary" strokeWidth={2} />
                  {t}
                </li>
              ))}
              <li className="pl-6.5 text-sm text-zinc-500">…and eight more.</li>
            </ul>

            <button
              onClick={() => setOpen(true)}
              className="relative mx-auto mt-8 flex items-center justify-center gap-2 rounded-full bg-primary px-8 py-4 text-base font-medium text-white transition hover:brightness-110 dark:text-zinc-950"
            >
              See what&rsquo;s inside
              <ArrowRight className="h-4 w-4" strokeWidth={2} />
            </button>
            {/* Stated before the click, not after it. A reader who feels
                bait-and-switched at the end does not come back. */}
            <p className="relative mt-3 text-center text-xs text-zinc-500">
              Two minutes. It&rsquo;s not on sale yet, but this is what&rsquo;s coming.
            </p>
          </div>

          {/* ---- The free plan: beside it, smaller, and complete ---------- */}
          <div className="flex w-full max-w-2xl flex-col rounded-2xl border border-zinc-200 bg-white p-6 dark:border-subtle dark:bg-card lg:w-56 lg:shrink-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-400 dark:text-zinc-500">
              Free
            </p>
            <p className="mt-1.5 text-xl font-semibold text-zinc-900 dark:text-zinc-50">$0</p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              A complete journal. Not a trial, and nothing expires.
            </p>

            <ul className="mt-4 space-y-1.5 text-[13px] text-zinc-600 dark:text-zinc-400">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-1.5">
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-zinc-400" strokeWidth={2.5} />
                  {f}
                </li>
              ))}
            </ul>

            {/* Outlined rather than filled: the section should have exactly
                one button that shouts, and it is not this one. */}
            <Link
              href="/sign-up"
              className="mt-5 block rounded-lg border border-zinc-300 px-3 py-2 text-center text-[13px] font-medium text-zinc-700 transition hover:border-primary/50 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-zinc-100"
            >
              Start free
            </Link>
          </div>
        </div>
      </section>

      <PaidPlanModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
