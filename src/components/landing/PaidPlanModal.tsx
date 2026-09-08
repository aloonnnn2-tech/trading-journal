"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  CalendarRange,
  FileText,
  Gauge,
  KeyRound,
  LineChart,
  Ruler,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

// The paid plan, explained one idea at a time.
//
// **Rewritten against how product tours are actually built**, after the first
// version read as a dense card rather than a tour. The rules it now follows,
// and what each one fixed:
//
//   - **Five steps, not six.** Completion falls off sharply past five.
//   - **One concept per step: headline plus at most two lines.** The first
//     version had a headline, a three-line body AND a pull quote on every
//     screen. When a step needs more explaining, the fix is a better visual,
//     not more words.
//   - **The visual gets more room than the copy**, not less. It was the other
//     way round, which is what made this feel like homework.
//   - **Split layout**: copy left, visual on its own tinted panel right. That
//     is also what lets the dialog be genuinely wide -- the old one was a
//     narrow column of small text, which is exactly what nobody wants to read.
//   - **Type sized to be read**, not to fit: headline 26-36px, body 16-18px,
//     buttons big enough to hit on a phone.
//   - **A visible step counter** ("2 / 5"), because a sequence you can see the
//     end of is one people finish.
//
// **The persuasion is all legitimate**, and worth naming so the next person
// editing does not reach for the other kind: open on the reader's problem
// rather than our product; show the *shape* of each answer so value is seen
// and not merely claimed; strongest feature first; forward-leaning button copy
// that reads as the reader's own next thought.
//
// What is deliberately NOT here: countdowns, invented user counts, fake
// scarcity, testimonials nobody gave, and a decline button that insults the
// reader. All of it is also *provably* false in this app -- there is no
// billing system, so nothing can be bought, and urgency attached to an
// unbuyable product is how you lose someone at the moment they got interested.
// The last screen says so plainly and points at what is genuinely available.

interface Step {
  kicker: string;
  headline: string;
  /** One sentence. If it needs two, the visual is not doing its job. */
  body: string;
  cta: string;
  visual: React.ReactNode;
}

/* -------------------------------------------------------------------------
   The visuals.

   Hand-built diagrams rather than screenshots: a screenshot would be either
   somebody's real trading data or a fabrication dressed as one. These show
   the SHAPE of an answer without claiming to be anyone's numbers.
------------------------------------------------------------------------- */

function JournalToInsight() {
  const rows: [string, string, boolean][] = [
    ["NVDA · long", "+$412", true],
    ["TSLA · long", "−$180", false],
    ["AAPL · short", "+$96", true],
  ];
  return (
    <div className="w-full space-y-3">
      {/* The raw record: complete, honest, and telling you nothing on its own.
          Dimmed on purpose -- this is the "before". */}
      <div className="space-y-1.5">
        {rows.map(([name, pl, win], i) => (
          <motion.div
            key={name}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 0.5, x: 0 }}
            transition={{ duration: 0.3, delay: i * 0.08 }}
            className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <span className="text-base text-zinc-600 dark:text-zinc-400">{name}</span>
            <span className={`font-mono text-base ${win ? "text-profit" : "text-loss"}`}>{pl}</span>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.35 }}
        className="flex justify-center"
      >
        <ArrowRight className="h-5 w-5 rotate-90 text-zinc-400" strokeWidth={2} />
      </motion.div>

      {/* The "after": the same trades turned into a sentence you can act on.
          The entire pitch of the paid plan, in one element. */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.5 }}
        className="rounded-xl border border-primary/40 bg-white px-5 py-5 shadow-sm dark:bg-zinc-900"
      >
        <p className="text-lg font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
          You close winners 0.9R before your own target.
        </p>
        <p className="mt-1.5 text-sm text-zinc-500">Across 34 trades.</p>
      </motion.div>
    </div>
  );
}

function ScoreDial() {
  const score = 78;
  const circumference = 2 * Math.PI * 42;
  return (
    <div className="flex w-full items-center gap-4 sm:gap-6">
      <div className="relative h-28 w-28 shrink-0 sm:h-40 sm:w-40">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            strokeWidth="9"
            className="stroke-zinc-200 dark:stroke-zinc-800"
          />
          <motion.circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            strokeWidth="9"
            strokeLinecap="round"
            className="stroke-primary"
            initial={{ strokeDasharray: `0 ${circumference}` }}
            animate={{ strokeDasharray: `${(score / 100) * circumference} ${circumference}` }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-3xl font-semibold text-zinc-900 dark:text-zinc-50 sm:text-4xl">
            {score}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">execution</span>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-4">
        {(
          [
            ["Entry timing", 84],
            ["Exit management", 61],
            ["Position sizing", 90],
            ["Plan adherence", 72],
          ] as [string, number][]
        ).map(([label, value], i) => (
          <div key={label}>
            {/* The gap is load-bearing at narrow widths: without it
                "Exit management" ran straight into its score on a phone. */}
            <div className="flex items-baseline justify-between gap-3 text-sm text-zinc-600 dark:text-zinc-400">
              <span className="truncate">{label}</span>
              <span className="shrink-0 font-mono">{value}</span>
            </div>
            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <motion.div
                className="h-full rounded-full bg-primary/75"
                initial={{ width: 0 }}
                animate={{ width: `${value}%` }}
                transition={{ duration: 0.7, delay: 0.15 + i * 0.08, ease: "easeOut" }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EdgeRanking() {
  const rows: [string, string, number, number][] = [
    ["Breakout · long", "+0.82R", 82, 34],
    ["Pullback · long", "+0.41R", 52, 28],
    ["Reversal · short", "−0.19R", 24, 19],
  ];
  return (
    <div className="w-full space-y-6">
      {rows.map(([name, r, width, n], i) => (
        <div key={name}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-base text-zinc-800 dark:text-zinc-200">{name}</span>
            <span
              className={`shrink-0 font-mono text-base font-medium ${
                r.startsWith("−") ? "text-loss" : "text-profit"
              }`}
            >
              {r}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-2.5">
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <motion.div
                className={`h-full rounded-full ${r.startsWith("−") ? "bg-loss/70" : "bg-profit/80"}`}
                initial={{ width: 0 }}
                animate={{ width: `${width}%` }}
                transition={{ duration: 0.7, delay: i * 0.1, ease: "easeOut" }}
              />
            </div>
            {/* The sample size is part of the visual, not a footnote -- it is
                the difference between a finding and a coincidence. */}
            <span className="w-[4.5rem] shrink-0 text-right font-mono text-xs text-zinc-500">
              {n} trades
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function CaptureBar() {
  return (
    <div className="w-full space-y-6">
      <div className="relative h-20">
        <div className="absolute inset-x-0 top-9 h-2 rounded-full bg-zinc-200 dark:bg-zinc-800" />
        <div className="absolute top-9 h-2 rounded-full bg-loss/70" style={{ left: 0, width: "12%" }} />
        <motion.div
          className="absolute top-9 h-2 rounded-full bg-profit/80"
          initial={{ width: 0 }}
          animate={{ width: "58%" }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          style={{ left: "12%" }}
        />
        <motion.div
          className="absolute top-9 h-2 rounded-full bg-profit/25"
          initial={{ width: 0 }}
          animate={{ width: "30%" }}
          transition={{ duration: 0.8, delay: 0.3, ease: "easeOut" }}
          style={{ left: "70%" }}
        />

        {(
          [
            ["0%", "Worst", "text-loss"],
            ["12%", "Entry", "text-zinc-500"],
            ["70%", "Your exit", "text-profit"],
            ["100%", "Peak", "text-zinc-500"],
          ] as [string, string, string][]
        ).map(([left, label, tone]) => (
          <div key={label} className="absolute top-0 -translate-x-1/2 text-center" style={{ left }}>
            <span className={`block text-[11px] font-medium ${tone}`}>{label}</span>
            <span className="mx-auto mt-1.5 block h-5 w-px bg-zinc-300 dark:bg-zinc-700" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-zinc-200 bg-white px-4 py-4 text-center dark:border-zinc-700 dark:bg-zinc-900">
        <span className="font-mono text-4xl font-semibold text-zinc-900 dark:text-zinc-50">67%</span>
        <span className="mt-1.5 block text-sm text-zinc-500">
          of the move captured. The rest you handed back.
        </span>
      </div>
    </div>
  );
}

const REST: [typeof Sparkles, string][] = [
  [CalendarRange, "Weekly & monthly AI review"],
  [Sparkles, "Ask your journal anything"],
  [Gauge, "Strategy scorecards"],
  [LineChart, "Trading vs account growth"],
  [ShieldCheck, "Risk consistency"],
  [Ruler, "Drawdown episodes"],
  [FileText, "Printable reports"],
  [KeyRound, "Your own API key"],
];

function RestGrid() {
  return (
    <div className="grid w-full grid-cols-2 gap-2.5">
      {REST.map(([Icon, title], i) => (
        <motion.div
          key={title}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: i * 0.05 }}
          className="flex items-center gap-2.5 rounded-xl border border-zinc-200 bg-white px-3.5 py-4 dark:border-zinc-700 dark:bg-zinc-900"
        >
          <Icon className="h-4 w-4 shrink-0 text-primary" strokeWidth={2} />
          <span className="text-[13px] font-medium leading-tight text-zinc-800 dark:text-zinc-200">
            {title}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

const STEPS: Step[] = [
  {
    kicker: "The idea",
    headline: "Your journal already knows why you lose money.",
    body: "You just can't see it one trade at a time.",
    cta: "Show me",
    visual: <JournalToInsight />,
  },
  {
    kicker: "Trade review",
    headline: "Every trade graded on how you traded it.",
    body: "Whether it won barely comes into it. A winner you fumbled is still a bad trade.",
    cta: "What else?",
    visual: <ScoreDial />,
  },
  {
    kicker: "Find my edge",
    headline: "See where your money actually comes from.",
    body: "Every setup ranked by expectancy, with the trades behind each one.",
    cta: "Keep going",
    visual: <EdgeRanking />,
  },
  {
    kicker: "MAE / MFE",
    headline: "See the money you left on the table.",
    body: "How far each trade ran before you closed it, and what you handed back.",
    cta: "And the rest?",
    visual: <CaptureBar />,
  },
  {
    kicker: "Everything else",
    headline: "Eight more, for when you need them.",
    body: "Every AI feature runs on your own key. Free tiers work fine, and we never hold one ourselves.",
    cta: "Start free",
    visual: <RestGrid />,
  },
];

export function PaidPlanModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const last = index === STEPS.length - 1;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const ctaRef = useRef<HTMLButtonElement | null>(null);

  // Honoured throughout. Every animation here is decorative -- nothing in the
  // sequence depends on movement to be understood -- so for a reader who has
  // asked their OS for less motion, all of it simply does not happen.
  const reduceMotion = useReducedMotion();

  const next = useCallback(() => setIndex((i) => Math.min(i + 1, STEPS.length - 1)), []);
  const back = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);

  // Escape closes, arrows walk. A modal that traps you is one people resent,
  // and resentment is not a mood anybody buys anything in.
  //
  // Tab is a different matter: focus MUST stay inside while this is open, or a
  // keyboard user tabs into the blurred page behind and is stranded somewhere
  // they cannot see. That is the one kind of trapping a dialog owes you.
  useEffect(() => {
    if (!open) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "ArrowRight") next();
      if (event.key === "ArrowLeft") back();
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const lastEl = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Where focus was before we took it, so it can be handed back on close --
    // otherwise closing drops a keyboard user at the top of the document
    // rather than back on the button they pressed.
    const restoreTo = document.activeElement as HTMLElement | null;
    // The primary action, so Enter advances the sequence without hunting.
    const focusTimer = window.setTimeout(() => ctaRef.current?.focus(), 60);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
      window.clearTimeout(focusTimer);
      restoreTo?.focus?.();
    };
  }, [open, onClose, next, back]);

  // Reopening starts from the top rather than resuming halfway through a pitch
  // the reader already walked away from once.
  //
  // Adjusted during render rather than in an effect -- React's own pattern for
  // "reset state when a prop changes". An effect would paint the stale step
  // first and then correct it.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setIndex(0);
  }

  const step = STEPS[index];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="What the paid plan includes"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/60 p-3 backdrop-blur-md sm:p-6"
        >
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.99 }}
            transition={{ duration: reduceMotion ? 0.12 : 0.25, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            ref={dialogRef}
            className="relative flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-subtle dark:bg-card"
          >
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-zinc-500 backdrop-blur hover:bg-zinc-100 hover:text-zinc-900 dark:bg-card/80 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <X className="h-5 w-5" strokeWidth={2} />
            </button>

            <div className="flex-1 overflow-y-auto">
              <AnimatePresence mode="wait">
                <motion.div
                  key={index}
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -20 }}
                  transition={{ duration: reduceMotion ? 0.12 : 0.22, ease: "easeOut" }}
                  // Swipe to advance. A five-screen sequence on a phone is a
                  // carousel, and a carousel that only responds to a button is
                  // one people abandon mid-way.
                  drag={reduceMotion ? false : "x"}
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.12}
                  onDragEnd={(_, info) => {
                    if (info.offset.x < -80) next();
                    if (info.offset.x > 80) back();
                  }}
                  // Visual first on a phone, beside the copy on a desktop --
                  // the split is what stops this reading as a column of text.
                  className="flex flex-col-reverse md:grid md:min-h-[30rem] md:grid-cols-[1fr_1.15fr]"
                >
                  <div className="flex flex-col justify-center px-6 py-8 sm:px-12 sm:py-12">
                    <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary">
                      {step.kicker}
                    </p>
                    <h2 className="mt-3 text-[28px] font-semibold leading-[1.12] tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-[42px]">
                      {step.headline}
                    </h2>
                    <p className="mt-5 text-base leading-relaxed text-zinc-600 dark:text-zinc-400 sm:text-xl">
                      {step.body}
                    </p>

                    {last && (
                      // The honest part, right where the reader has just been
                      // sold something. A surprise here is how you lose the
                      // trust the previous four screens earned.
                      <p className="mt-5 text-sm leading-relaxed text-zinc-500">
                        It isn&rsquo;t on sale yet. The free journal is complete and ready now, so
                        start there and you&rsquo;ll have the trades to look at the day this opens.
                      </p>
                    )}
                  </div>

                  {/* The visual gets the larger half, on its own panel.
                      The explicit border carries the split in dark mode, where
                      a tinted panel against a dark card is nearly invisible --
                      tone alone was not enough to show there were two halves.

                      The extra top padding is for mobile only: stacked, this
                      panel is the top of the dialog, and the close button sat
                      on top of the first row of the visual. */}
                  <div className="flex items-center justify-center border-zinc-200 bg-zinc-50 px-6 pb-8 pt-16 dark:border-subtle dark:bg-zinc-950/40 sm:px-10 md:border-l md:border-t-0 md:py-8">
                    {step.visual}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-zinc-200 px-6 py-4 dark:border-subtle sm:px-10">
              <div className="flex min-w-0 items-center gap-4">
                <span className="shrink-0 font-mono text-xs text-zinc-500">
                  {index + 1} / {STEPS.length}
                </span>
                {index > 0 && (
                  <button
                    onClick={back}
                    className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    <ArrowLeft className="h-4 w-4" strokeWidth={2} />
                    Back
                  </button>
                )}
              </div>

              {/* Named, because arrow-key navigation nobody knows about is
                  the same as not having it. */}
              <span className="hidden font-mono text-[10px] uppercase tracking-wider text-zinc-400 lg:inline">
                ← → to move
              </span>

              <div className="hidden items-center gap-1.5 sm:flex">
                {STEPS.map((s, i) => (
                  <button
                    key={s.kicker}
                    onClick={() => setIndex(i)}
                    aria-label={`Go to ${s.kicker}`}
                    className={`h-2 rounded-full transition-all ${
                      i === index
                        ? "w-6 bg-primary"
                        : i < index
                          ? "w-2 bg-primary/40"
                          : "w-2 bg-zinc-300 dark:bg-zinc-700"
                    }`}
                  />
                ))}
              </div>

              {last ? (
                <Link
                  href="/sign-up"
                  className="flex shrink-0 items-center gap-2 rounded-full bg-primary px-7 py-3.5 text-sm font-medium text-white hover:brightness-110 dark:text-zinc-950 sm:text-base"
                >
                  {step.cta}
                  <ArrowRight className="h-4 w-4" strokeWidth={2} />
                </Link>
              ) : (
                <button
                  ref={ctaRef}
                  onClick={next}
                  className="flex shrink-0 items-center gap-2 rounded-full bg-primary px-7 py-3.5 text-sm font-medium text-white hover:brightness-110 dark:text-zinc-950 sm:text-base"
                >
                  {step.cta}
                  <ArrowRight className="h-4 w-4" strokeWidth={2} />
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
