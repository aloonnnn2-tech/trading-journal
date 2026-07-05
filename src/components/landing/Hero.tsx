"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { HeroPanel } from "@/components/landing/illustrations";

const CAPABILITIES = [
  "equity curve",
  "r-multiples",
  "emotion tags",
  "pattern detection",
  "csv / xlsx import",
  "version history",
];

export function Hero() {
  return (
    <section className="relative overflow-hidden px-6 pt-16 pb-20 sm:px-10 lg:pt-24 lg:pb-28">
      <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
        <div className="flex flex-col items-start gap-6 text-left">
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
            Free · No credit card
          </span>
          <h1 className="max-w-2xl text-4xl font-semibold leading-[1.05] tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-5xl lg:text-6xl">
            See the <span className="text-primary">pattern</span> behind every&nbsp;trade.
          </h1>
          <p className="max-w-lg text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
            Log entries in seconds, then let equity curves, R-multiples, and emotion tags
            show you exactly what&apos;s working — and what&apos;s quietly costing you money.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/sign-up"
              className="rounded-lg bg-primary px-6 py-3 font-medium text-white dark:text-zinc-950 shadow-lg shadow-primary/25 hover:brightness-110"
            >
              Start journaling free
            </Link>
            <Link
              href="/sign-in"
              className="rounded-lg border border-zinc-300 px-6 py-3 font-medium text-zinc-900 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-100 dark:hover:border-zinc-500"
            >
              Log in
            </Link>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
            {CAPABILITIES.map((c, i) => (
              <span key={c}>
                {c}
                {i < CAPABILITIES.length - 1 && <span className="ml-4 text-zinc-300 dark:text-zinc-700">·</span>}
              </span>
            ))}
          </div>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15, ease: "easeOut" }}
          className="relative"
        >
          <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-primary/20 via-accent/10 to-transparent blur-2xl" />
          <HeroPanel />
        </motion.div>
      </div>
    </section>
  );
}
