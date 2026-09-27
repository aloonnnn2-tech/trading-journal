"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, useMotionTemplate, useMotionValue } from "framer-motion";
import { ArrowRight, Check, Clock } from "lucide-react";
import { PaidPlanModal } from "@/components/landing/PaidPlanModal";
import { BorderBeam } from "@/components/landing/v2/BorderBeam";
import { Reveal } from "@/components/motion/Reveal";
import { WaitlistForm } from "@/components/landing/WaitlistForm";

// The pricing section for /home-v2. Same two plans, same copy, same honesty
// as ../PricingTeaser.tsx (which stays untouched): the paid card is the hero,
// the free card sits beside it complete and quiet, and every feature named is
// one `isPaidUser` actually gates.
//
// What changes is that the paid card stops being a list. The three teasers
// become three small live panels -- a score dial, a ranked-setups chart, a
// capture meter -- built from figures that are already on this page (the
// Find My Edge and MAE/MFE screenshots come from the same demo account), so
// the card shows the paid plan doing its job instead of describing it. It
// carries a light round its border, a spotlight that follows the pointer, and
// the only filled button on the section. The free card is unchanged apart
// from sitting a touch quieter next to it.

const FREE_FEATURES = [
  "Unlimited trades",
  "Equity curve & drawdown",
  "Win rate, profit factor, expectancy",
  "Trading rules & mistake tracking",
  "Goals, imports, exports",
  "Edit history on every trade",
];

// The review card's score, drawn as a dial. The ring fills on view; the
// number is simply there, because it is a figure and not decoration.
function ScoreDial() {
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 48 48" className="h-12 w-12 shrink-0 -rotate-90" aria-hidden>
        <circle cx="24" cy="24" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-zinc-200 dark:text-zinc-800" />
        <motion.circle
          data-decor
          cx="24"
          cy="24"
          r={r}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          whileInView={{ strokeDashoffset: c * (1 - 0.78) }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.6, delay: 0.1, ease: "easeOut" }}
        />
      </svg>
      <div>
        <p className="font-mono text-2xl font-semibold leading-none text-zinc-900 dark:text-zinc-50">
          78
          <span className="ml-1 text-xs font-normal text-zinc-500">/ 100</span>
        </p>
        <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-zinc-500">execution</p>
      </div>
    </div>
  );
}

// Find My Edge's top three, from the screenshot above.
const EDGES: [string, string, number][] = [
  ["Ran to target", "+2.74R", 100],
  ["Closed short", "+0.98R", 36],
  ["1–2 days", "+0.52R", 19],
];

function RankedSetups() {
  return (
    <div className="flex flex-col gap-1.5">
      {EDGES.map(([label, r, pct], i) => (
        <div key={label} className="flex items-center gap-2 text-[11px]">
          <span className="w-[4.6rem] shrink-0 truncate text-zinc-500">{label}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <motion.div
              className="h-full origin-left rounded-full bg-primary"
              style={{ width: `${pct}%` }}
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: 0.1 + i * 0.06, ease: "easeOut" }}
            />
          </div>
          <span className="w-12 shrink-0 text-right font-mono text-profit">{r}</span>
        </div>
      ))}
    </div>
  );
}

// The MAE/MFE panel's headline figures, from the screenshot above.
function CaptureMeter() {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-2xl font-semibold leading-none text-zinc-900 dark:text-zinc-50">
          39%
        </p>
        <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">captured</p>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <motion.div
          className="h-full w-[39%] origin-left rounded-full bg-primary"
          initial={{ scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.6, delay: 0.1, ease: "easeOut" }}
        />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10px]">
        <span className="text-loss">MAE −2.47%</span>
        <span className="text-profit">MFE +3.55%</span>
      </div>
    </div>
  );
}

const PANELS = [
  { title: "Every trade graded on how you traded it, not on whether it won", visual: ScoreDial },
  { title: "Which of your setups is actually carrying the rest", visual: RankedSetups },
  { title: "How much of each move you captured, and what you gave back", visual: CaptureMeter },
];

export function PricingTeaser() {
  const [open, setOpen] = useState(false);
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const [hovered, setHovered] = useState(false);
  const spotlight = useMotionTemplate`radial-gradient(420px circle at ${px}px ${py}px, color-mix(in srgb, var(--color-primary) 14%, transparent), transparent 70%)`;

  return (
    <>
      <section id="pricing" className="mx-auto w-full max-w-7xl scroll-mt-20 px-6 sm:px-10">
        <div className="flex flex-col items-center justify-center gap-5 lg:flex-row lg:items-center">
          <div aria-hidden className="hidden xl:block xl:w-56 xl:shrink-0" />

          {/* ---- The paid plan: the hero, and now the product ------------- */}
          <Reveal
            onPointerMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              px.set(e.clientX - r.left);
              py.set(e.clientY - r.top);
            }}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            className="relative w-full max-w-2xl shrink-0 overflow-hidden rounded-2xl border border-primary/50 bg-white p-7 shadow-[0_24px_80px_-32px_color-mix(in_srgb,var(--color-primary)_55%,transparent)] dark:bg-card sm:p-8"
          >
            <BorderBeam size={140} duration={7} />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/[0.07] via-transparent to-transparent"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 -top-32 h-72 bg-[radial-gradient(ellipse_at_top,color-mix(in_srgb,var(--color-primary)_28%,transparent),transparent_70%)]"
            />
            <motion.div
              aria-hidden
              style={{ background: spotlight }}
              animate={{ opacity: hovered ? 1 : 0 }}
              transition={{ duration: 0.3 }}
              className="pointer-events-none absolute inset-0"
            />

            <div className="relative flex items-center justify-center gap-3">
              <p
                className="animate-text-shimmer bg-[length:200%_auto] bg-clip-text font-mono text-[11px] uppercase tracking-[0.22em] text-transparent"
                style={{
                  backgroundImage: "linear-gradient(90deg, var(--color-primary), var(--color-accent), var(--color-primary))",
                }}
              >
                Paid
              </p>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400">
                <Clock className="h-3 w-3" strokeWidth={2} />
                Coming soon
              </span>
            </div>

            <h3 className="relative mx-auto mt-4 max-w-lg text-center text-2xl font-semibold leading-[1.15] tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-[34px]">
              A second read on your own history.
            </h3>
            <p className="relative mx-auto mt-3 max-w-md text-center text-base text-zinc-500 sm:text-lg">
              The free plan keeps the record. The paid plan reviews it: each trade scored on
              execution, your strongest setups ranked, and the month written up as a report.
            </p>

            {/* The three teasers, shown working. */}
            <div className="relative mt-6 grid gap-3 sm:grid-cols-3">
              {PANELS.map((panel, i) => (
                <Reveal
                  key={panel.title}
                  delay={i * 0.05}
                  className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-3.5 dark:border-subtle dark:bg-zinc-950/60"
                >
                  <panel.visual />
                  <p className="mt-2.5 text-xs leading-snug text-zinc-600 dark:text-zinc-400">{panel.title}</p>
                </Reveal>
              ))}
            </div>
            <p className="relative mt-2.5 text-center text-xs text-zinc-500">…and eight more.</p>

            <div className="relative">
              <button
                onClick={() => setOpen(true)}
                className="group relative mx-auto mt-5 flex items-center justify-center gap-2 overflow-hidden rounded-lg bg-primary px-8 py-4 text-base font-medium text-white shadow-lg shadow-primary/30 transition hover:bg-primary-hover dark:text-zinc-950"
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 animate-shimmer bg-[linear-gradient(110deg,transparent_35%,rgba(255,255,255,0.35)_50%,transparent_65%)]"
                />
                <span className="relative">See what&rsquo;s inside</span>
                <ArrowRight className="relative h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
              </button>
              <p className="relative mt-3 text-center text-xs text-zinc-500">
                Two minutes. It&rsquo;s not on sale yet, but this is what&rsquo;s coming.
              </p>
              <Link
                href="/paid-plan"
                className="relative mx-auto mt-4 flex items-center justify-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                Read how every feature works
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
              </Link>

              {/* Phase 2B: the waitlist. Issue 9 of docs/design-audit.md
                  relabels this card "Coming soon" and asks for a way to hear
                  when it isn't. */}
              <div className="relative mt-6 border-t border-zinc-200 pt-5 dark:border-subtle">
                <p className="mb-3 text-center text-sm text-zinc-600 dark:text-zinc-400">
                  Get one email when it launches.
                </p>
                <WaitlistForm source="home-paid-card" />
              </div>
            </div>
          </Reveal>

          {/* ---- The free plan: beside it, smaller, complete, quiet -------- */}
          <Reveal
            delay={0.05}
            className="flex w-full max-w-2xl flex-col rounded-2xl border border-zinc-200/80 bg-white/70 p-6 dark:border-subtle/80 dark:bg-card/70 lg:w-56 lg:shrink-0"
          >
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

            <Link
              href="/sign-up"
              className="mt-5 block rounded-lg border border-zinc-300 px-3 py-2 text-center text-[13px] font-medium text-zinc-700 transition hover:border-primary/50 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-zinc-100"
            >
              Start journaling free
            </Link>
          </Reveal>
        </div>
      </section>

      <PaidPlanModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
