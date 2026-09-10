"use client";

import { motion } from "framer-motion";

// The selling section: what this does that a spreadsheet, or a journal that
// is really a spreadsheet with a logo, will not do for you.
//
// Every claim here maps to a feature that actually ships -- rule grading,
// automatic mistake detection, MAE/MFE capture, screenshot OCR. Nothing is
// aspirational and nothing is invented, which is the only way this stays
// honest marketing rather than the fabricated kind the redesign is avoiding.
//
// Shape: a claim, three numbered proofs down the left, and a plain-language
// "how long this takes you" strip at the bottom. It reads vertically, which
// no other section on the page does -- the hero is split, the pillars are
// three-up, the stories alternate, the timeline runs horizontally. That is
// deliberate: sameness of shape was the thing making the page feel assembled
// rather than designed.

const PROOFS = [
  {
    n: "01",
    title: "Your rules, graded without you",
    body:
      "Write the plan once. Every trade is checked against it, and the ones that broke it are " +
      "flagged on their own. You are not tagging anything by hand, which is the reason most " +
      "rule-tracking dies in week three.",
  },
  {
    n: "02",
    title: "Mistakes you never logged",
    body:
      "A stop you moved, a position you sized up, an exit you took early. Counted from the trade " +
      "data itself, so the number you see is the number that happened rather than the number you " +
      "felt like recording.",
  },
  {
    n: "03",
    title: "How far it went against you",
    body:
      "MAE and MFE on every trade: the heat you sat through, and how much of the move you actually " +
      "captured. That is the difference between a stop that was too tight and a thesis that was " +
      "wrong, and it is invisible in a P/L column.",
  },
];

export function WhatsDifferent() {
  return (
    <section
      id="different"
      data-v2-different
      className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 pb-24 sm:px-10"
    >
      <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
            Three things a spreadsheet won&rsquo;t do
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
            A spreadsheet records. This one answers back.
          </h2>
          <p className="mt-4 max-w-md text-zinc-600 dark:text-zinc-400">
            Logging trades is the easy half, and it is the half every journal does. The work that
            actually changes a P/L curve is the part that happens after the trade closes.
          </p>
        </div>

        <ol className="flex flex-col">
          {PROOFS.map((proof, i) => (
            // framer rather than a CSS scroll timeline: `viewport once` fires
            // one time and leaves the element where it landed. A view()
            // timeline is scroll-linked in both directions, so an opacity-0
            // start state would blank these again on the way back up.
            <motion.li
              key={proof.n}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, delay: i * 0.1, ease: "easeOut" }}
              data-v2-proof
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
            </motion.li>
          ))}
        </ol>
      </div>

      {/* The ease-of-use claim, kept to things that are literally true of the
          import paths that ship: OCR from a screenshot, CSV/Excel from a
          broker, and autosave on the form. */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        data-v2-ease
        className="mt-14 flex flex-col gap-6 rounded-xl border border-zinc-200 px-6 py-6 dark:border-subtle sm:flex-row sm:items-center sm:justify-between sm:px-8"
      >
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Getting your trades in takes a sitting, not a weekend
          </h3>
          <p className="mt-1.5 max-w-xl text-[15px] text-zinc-600 dark:text-zinc-400">
            Drop in a screenshot and the form fills itself. Bring a CSV or Excel file from your
            broker and the whole history comes with it. Everything autosaves as you type.
          </p>
        </div>
        <dl className="flex shrink-0 gap-8">
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
              Screenshot
            </dt>
            <dd className="mt-1 font-mono text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              OCR
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
              Bulk import
            </dt>
            <dd className="mt-1 font-mono text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              CSV / XLSX
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
              Setup cost
            </dt>
            <dd className="mt-1 font-mono text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              Free
            </dd>
          </div>
        </dl>
      </motion.div>
    </section>
  );
}
