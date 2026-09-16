"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { BorderBeam } from "@/components/landing/v2/BorderBeam";
import { Words } from "@/components/landing/v2/Words";

// The closing ask for /home-v2. Same copy and card as ../ClosingCTA.tsx,
// which stays untouched. What moves: the chart line under the card draws
// itself as the card scrolls in, the heading arrives word by word, a light
// runs round the card's border and the button catches a sweep every few
// seconds, like the hero's.
export function ClosingCTA() {
  return (
    <section className="px-6 pb-24 sm:px-10">
      <motion.div
        className="relative mx-auto max-w-6xl overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-subtle dark:bg-card"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      >
        <BorderBeam size={100} duration={9} />
        {/* recessive chart-line motif */}
        <svg
          viewBox="0 0 800 160"
          className="pointer-events-none absolute inset-x-0 bottom-0 w-full opacity-[0.07]"
          aria-hidden="true"
          preserveAspectRatio="none"
        >
          <motion.polyline
            points="0,140 60,128 120,134 180,112 240,120 300,96 360,104 420,82 480,90 540,64 600,72 660,44 720,52 800,24"
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth="3"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 1.6, delay: 0.2, ease: "easeInOut" }}
          />
        </svg>
        <div className="relative flex flex-col items-center gap-4 px-6 py-16 text-center sm:px-10">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
            <Words text="Start with your next trade." delay={0.15} />
          </h2>
          <motion.p
            className="max-w-md text-zinc-600 dark:text-zinc-400"
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.4, delay: 0.5, ease: "easeOut" }}
          >
            An account takes a minute to open. Free to use, with no card required.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.4, delay: 0.65, ease: "easeOut" }}
          >
            <Link
              href="/sign-up"
              className="relative mt-2 inline-block overflow-hidden rounded-lg bg-primary px-6 py-3 font-medium text-white dark:text-zinc-950 shadow-lg shadow-primary/25 hover:brightness-110"
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 animate-shimmer bg-[linear-gradient(110deg,transparent_35%,rgba(255,255,255,0.35)_50%,transparent_65%)]"
              />
              <span className="relative">Start journaling free</span>
            </Link>
          </motion.div>
        </div>
      </motion.div>
    </section>
  );
}
