"use client";

import { motion } from "framer-motion";
import { ClipboardCheck, NotebookPen, TrendingUp } from "lucide-react";

// Three big panels across the page, before any detail.
//
// **Why this exists.** The page underneath was four alternating copy/visual
// blocks followed by twelve identical cards -- every section the same shape,
// so scrolling felt like the same box repeating rather than an argument being
// made. This is the opposite shape: three tall panels, side by side, read in
// one glance, and it states the whole product in three words before the page
// starts explaining anything.
//
// It is also the actual loop the app is built around -- record, judge,
// improve -- so the sections that follow are detail on these three rather
// than a fresh list.

const PILLARS = [
  {
    number: "01",
    word: "Record",
    icon: NotebookPen,
    headline: "Every trade, exactly as it happened",
    body: "Price, size, stop, screenshots, plus any field you want to add. Every edit is saved, so the record can't quietly change on you later.",
  },
  {
    number: "02",
    word: "Judge",
    icon: ClipboardCheck,
    headline: "Against the rules you wrote",
    body: "Your plan, checked on every trade. Moved stops, oversized positions and early exits get flagged without you tagging anything.",
    featured: true,
  },
  {
    number: "03",
    word: "Improve",
    icon: TrendingUp,
    headline: "Find what actually makes money",
    body: "Which setups carry you, and which habits cost you. Nothing gets claimed off the back of three trades.",
  },
];

export function ThreePillars() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 pb-24 sm:px-10">
      <div className="grid gap-4 md:grid-cols-3">
        {PILLARS.map((pillar, i) => (
          <motion.div
            key={pillar.word}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.45, delay: i * 0.1, ease: "easeOut" }}
            // The fixed height only applies once they sit side by side and need to
            // match. Stacked on a phone it just opened a gap between the
            // headline and the body of every panel.
            className={`relative flex flex-col overflow-hidden rounded-2xl border p-7 sm:p-8 md:min-h-[19rem] ${
              pillar.featured
                ? "border-primary/40 bg-white dark:bg-card"
                : "border-zinc-200 bg-white dark:border-subtle dark:bg-card"
            }`}
          >
            {/* The middle panel is lifted rather than all three being equal --
                a row of three identical boxes is the flatness this section
                exists to break, and "judge it" is the part that makes this a
                journal rather than a spreadsheet. */}
            {pillar.featured && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 -top-24 h-48 bg-[radial-gradient(ellipse_at_top,color-mix(in_srgb,var(--color-primary)_16%,transparent),transparent_70%)]"
              />
            )}

            {/* An oversized watermark of the icon, so each panel reads as a
                distinct thing at a glance rather than as another card. */}
            <pillar.icon
              aria-hidden
              className="pointer-events-none absolute -bottom-6 -right-4 h-40 w-40 text-zinc-900/[0.03] dark:text-white/[0.04]"
              strokeWidth={1}
            />

            <div className="relative flex items-baseline gap-2.5">
              <span className="font-mono text-xs text-zinc-400 dark:text-zinc-600">
                {pillar.number}
              </span>
              <span className="text-sm font-medium uppercase tracking-[0.18em] text-primary">
                {pillar.word}
              </span>
            </div>

            <h3 className="relative mt-6 text-2xl font-semibold leading-[1.2] tracking-tight text-zinc-900 dark:text-zinc-50">
              {pillar.headline}
            </h3>

            <p className="relative mt-auto pt-6 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              {pillar.body}
            </p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
