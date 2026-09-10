"use client";

import { motion } from "framer-motion";

// The selling section: the work this does once a trade is closed, which is
// the part a plain record cannot do for you.
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

export function WhatsDifferent() {
  return (
    <section
      id="different"
      data-v2-different
      className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 pb-24 sm:px-10"
    >
      <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        {/* Not sticky. A sticky heading here scrolled on past its own
            section and read as text sliding over the one below it. */}
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
            After the close
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
            Three jobs a plain record leaves to you.
          </h2>
          <p className="mt-4 max-w-md text-zinc-600 dark:text-zinc-400">
            Recording trades is the straightforward part, and most tools stop there. What comes
            after is where a journal starts to pay for itself.
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
            Getting your history in takes one sitting
          </h3>
          <p className="mt-1.5 max-w-xl text-[15px] text-zinc-600 dark:text-zinc-400">
            Drop in a screenshot and the form fills itself. Bring a CSV or Excel export from your
            broker and the rest of your history comes with it. Everything saves as you type.
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
