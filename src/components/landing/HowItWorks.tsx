"use client";

import { motion } from "framer-motion";

// The loop the app is built around, drawn as a line rather than three boxes.
//
// **Shape matters more than content here.** The page already has panels,
// pillars and a bento; a fourth row of bordered boxes was the thing making it
// feel repetitive. A connected timeline says "these are stages of one thing"
// in a way three separate cards never did -- and it is the only section on the
// page that reads horizontally, which is what makes it register as its own
// section rather than more of the last one.

const STEPS = [
  {
    number: "01",
    title: "Log the trade",
    description: "Price, size, stop and setup in under a minute. Or just drop in a screenshot.",
  },
  {
    number: "02",
    title: "Let your rules grade it",
    description: "Every trade checked against the plan you wrote, with mistakes caught for you.",
  },
  {
    number: "03",
    title: "Fix what it costs you",
    description: "See which setups and days make money, and what the rest are costing you in R.",
  },
];

export function HowItWorks() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 pb-24 sm:px-10">
      <div className="relative">
        {/* The connecting rail. Hidden below `sm`, where the steps stack and a
            horizontal line would run through nothing. */}
        <div
          aria-hidden
          className="absolute left-0 right-0 top-6 hidden h-px bg-gradient-to-r from-transparent via-zinc-300 to-transparent dark:via-zinc-700 sm:block"
        />

        <div className="grid gap-10 sm:grid-cols-3 sm:gap-6">
          {STEPS.map((step, i) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.4, delay: i * 0.12, ease: "easeOut" }}
              className="relative flex flex-col items-start"
            >
              {/* Sits on the rail and hides it behind itself, so the line
                  reads as passing through each marker rather than under it. */}
              <span className="relative z-10 flex h-12 w-12 items-center justify-center rounded-full border border-zinc-200 bg-white font-mono text-sm font-semibold text-primary dark:border-subtle dark:bg-card">
                {step.number}
              </span>
              <h3 className="mt-6 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                {step.title}
              </h3>
              <p className="mt-2 max-w-xs text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                {step.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
