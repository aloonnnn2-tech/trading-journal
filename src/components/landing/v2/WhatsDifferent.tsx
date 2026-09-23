"use client";

import { motion } from "framer-motion";
import { BorderBeam } from "@/components/landing/v2/BorderBeam";
import { Reveal } from "@/components/motion/Reveal";

// The selling section for the landing page: same claims, same copy and same
// shape as ../WhatsDifferent.tsx (which stays untouched; every claim there
// maps to a shipped feature and that has not changed). The left column
// arrives from the left and the three proofs from the right, and a rail draws
// down beside the proofs.
//
// The heading used to arrive a word at a time and the three mono values used
// to type themselves in. Both are gone: a headline that assembles itself over
// half a second, and a value that takes most of a second to spell "OCR", are
// text the reader is waiting on. Everything here now renders complete and
// moves 8px at most (issue 7 of docs/design-audit.md). The rail keeps its own
// motion -- it draws beside the text rather than holding it back.

const PROOFS = [
  {
    n: "01",
    title: "Your rules, applied to every trade",
    body:
      "Write your plan once. Every trade is measured against it, and the ones that broke it are " +
      "flagged for you. There is nothing to tag by hand, which is usually what decides whether " +
      "rule tracking survives past the first few weeks.",
  },
  {
    n: "02",
    title: "Mistakes counted from the data",
    body:
      "A stop that moved, a position sized above plan, an exit taken early. Each one is read from " +
      "the trade data itself, so the count reflects what happened rather than what you thought to " +
      "write down at the time.",
  },
  {
    n: "03",
    title: "How far it went against you",
    body:
      "MAE and MFE on every trade: how far price moved against you before the trade worked, and how " +
      "much of the move you kept. That is what separates a stop set too tight from a thesis that was " +
      "wrong, and a profit and loss column cannot tell you which one you are looking at.",
  },
];

// Both import claims are deliberately narrow, because the honest versions
// are different shapes. The screenshot path is confirmed against one broker
// and one asset class and says so. The file path is a format capability --
// the wizard takes .csv/.xlsx/.json and has you map the columns -- and makes
// no promise about any particular broker's export, because none has been
// tested. See "Facts Alon supplies" in docs/design-audit.md.
const FACTS: { label: string; value: string }[] = [
  { label: "Screenshot import", value: "IBKR · stocks" },
  { label: "File import", value: "CSV / XLSX / JSON" },
  { label: "Setup cost", value: "Free" },
];

export function WhatsDifferent() {
  return (
    <section id="different" className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 pb-24 sm:px-10">
      <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <div>
          <Reveal direction="left">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">After the close</p>
          </Reveal>
          <Reveal direction="left" delay={0.05}>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
              Three jobs a plain record leaves to you.
            </h2>
          </Reveal>
          <Reveal direction="left" delay={0.1}>
            <p className="mt-4 max-w-md text-zinc-600 dark:text-zinc-400">
              Recording trades is the straightforward part, and most tools stop there. What comes
              after is where a journal starts to pay for itself.
            </p>
          </Reveal>
        </div>

        {/* The rail sits in the column gap, so it adds no width to the list. */}
        <div className="relative">
          <motion.div
            aria-hidden
            data-decor
            className="absolute -left-8 top-0 hidden h-full w-px origin-top bg-gradient-to-b from-primary via-primary/50 to-transparent lg:block"
            initial={{ scaleY: 0 }}
            whileInView={{ scaleY: 1 }}
            viewport={{ once: true, margin: "0px 0px 20% 0px" }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
          <ol className="flex flex-col">
            {PROOFS.map((proof, i) => (
              <Reveal
                as="li"
                key={proof.n}
                direction="right"
                delay={i * 0.05}
                className="border-t border-zinc-200 py-7 first:border-t-0 first:pt-0 dark:border-subtle"
              >
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-xs text-zinc-400 dark:text-zinc-600">{proof.n}</span>
                  <h3 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                    {proof.title}
                  </h3>
                </div>
                <p className="mt-2.5 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {proof.body}
                </p>
              </Reveal>
            ))}
          </ol>
        </div>
      </div>

      <Reveal className="relative mt-14 flex flex-col gap-6 rounded-xl border border-zinc-200 px-6 py-6 dark:border-subtle sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <BorderBeam size={70} duration={8} />
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Getting your history in takes one sitting
          </h3>
          <p className="mt-1.5 max-w-xl text-[15px] text-zinc-600 dark:text-zinc-400">
            Drop in a screenshot and the form fills itself — confirmed for Interactive Brokers
            stock trades, and manual entry works for any broker or market. Bring a CSV, Excel or
            JSON file and you map its columns once to bring the rest of your history in.
            Everything saves as you type.
          </p>
        </div>
        <dl className="flex shrink-0 gap-8">
          {FACTS.map((fact) => (
            <div key={fact.label}>
              <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
                {fact.label}
              </dt>
              <dd className="mt-1 font-mono text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </Reveal>
    </section>
  );
}
