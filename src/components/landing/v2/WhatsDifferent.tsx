"use client";

import { motion } from "framer-motion";
import { BorderBeam } from "@/components/landing/v2/BorderBeam";
import { Slide } from "@/components/landing/v2/Slide";
import { Typewriter } from "@/components/landing/v2/Typewriter";
import { Words } from "@/components/landing/v2/Words";

// The selling section for /home-v2: same claims, same copy and same shape as
// ../WhatsDifferent.tsx (which stays untouched; every claim there maps to a
// shipped feature and that has not changed). What moves: the left column
// slides in from the left and the three proofs from the right, the heading
// arrives word by word, a rail draws down beside the proofs as they reveal,
// the three mono values in the strip type themselves in, and the strip
// carries a light round its border.

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

const FACTS: { label: string; value: string }[] = [
  { label: "Screenshot", value: "OCR" },
  { label: "Bulk import", value: "CSV / XLSX" },
  { label: "Setup cost", value: "Free" },
];

export function WhatsDifferent() {
  return (
    <section id="different" className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 pb-24 sm:px-10">
      <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <div>
          <Slide from="left">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">After the close</p>
          </Slide>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
            <Words text="Three jobs a plain record leaves to you." delay={0.1} />
          </h2>
          <Slide from="left" delay={0.45}>
            <p className="mt-4 max-w-md text-zinc-600 dark:text-zinc-400">
              Recording trades is the straightforward part, and most tools stop there. What comes
              after is where a journal starts to pay for itself.
            </p>
          </Slide>
        </div>

        {/* The rail sits in the column gap, so it adds no width to the list. */}
        <div className="relative">
          <motion.div
            aria-hidden
            className="absolute -left-8 top-0 hidden h-full w-px origin-top bg-gradient-to-b from-primary via-primary/50 to-transparent lg:block"
            initial={{ scaleY: 0 }}
            whileInView={{ scaleY: 1 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 1.2, ease: "easeOut" }}
          />
          <ol className="flex flex-col">
            {PROOFS.map((proof, i) => (
              <motion.li
                key={proof.n}
                initial={{ opacity: 0, x: 24 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: i * 0.12, ease: [0.23, 1, 0.32, 1] }}
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
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
        className="relative mt-14 flex flex-col gap-6 rounded-xl border border-zinc-200 px-6 py-6 dark:border-subtle sm:flex-row sm:items-center sm:justify-between sm:px-8"
      >
        <BorderBeam size={70} duration={8} />
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
          {FACTS.map((fact, i) => (
            <div key={fact.label}>
              <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
                {fact.label}
              </dt>
              <dd className="mt-1 font-mono text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                <Typewriter text={fact.value} delay={0.3 + i * 0.5} />
              </dd>
            </div>
          ))}
        </dl>
      </motion.div>
    </section>
  );
}
