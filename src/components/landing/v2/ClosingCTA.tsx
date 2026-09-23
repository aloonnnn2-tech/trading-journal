"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { BorderBeam } from "@/components/landing/v2/BorderBeam";
import { Reveal } from "@/components/motion/Reveal";

// The closing ask. Same copy and card as ../ClosingCTA.tsx, which stays
// untouched. The chart line under the card still draws itself, a light runs
// round the border, and the button catches a sweep every few seconds.
//
// What changed: the heading no longer assembles word by word, and the
// paragraph and button no longer wait 0.5s and 0.65s behind it. On a closing
// CTA that meant the ask itself was the last thing to arrive. The card now
// renders complete (issue 7 of docs/design-audit.md). The chart line is
// decorative and behind content at 7% opacity, so it keeps drawing -- capped
// at 600ms.
export function ClosingCTA() {
  return (
    <section className="px-6 pb-24 sm:px-10">
      <Reveal className="relative mx-auto max-w-6xl overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-subtle dark:bg-card">
        <BorderBeam size={100} duration={9} />
        {/* recessive chart-line motif */}
        <svg
          viewBox="0 0 800 160"
          className="pointer-events-none absolute inset-x-0 bottom-0 w-full opacity-[0.07]"
          aria-hidden="true"
          preserveAspectRatio="none"
        >
          <motion.polyline
            data-decor
            points="0,140 60,128 120,134 180,112 240,120 300,96 360,104 420,82 480,90 540,64 600,72 660,44 720,52 800,24"
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth="3"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true, margin: "0px 0px 20% 0px" }}
            transition={{ duration: 0.6, ease: "easeInOut" }}
          />
        </svg>
        <div className="relative flex flex-col items-center gap-4 px-6 py-16 text-center sm:px-10">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
            Start with your next trade.
          </h2>
          <p className="max-w-md text-zinc-600 dark:text-zinc-400">
            An account takes a minute to open. Free to use, with no card required.
          </p>
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
        </div>
      </Reveal>
    </section>
  );
}
