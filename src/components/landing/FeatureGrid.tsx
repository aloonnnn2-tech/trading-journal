"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeftRight,
  CalendarRange,
  ClipboardCheck,
  Compass,
  FileText,
  History,
  LineChart,
  NotebookPen,
  Ruler,
  Sparkles,
  Target,
  type LucideIcon,
} from "lucide-react";

// The full capability list, as a bento rather than a wall of equal cards.
//
// **Two problems, one fix.** This grid used to name three features and stop,
// which badly undersold a free tier that has since grown rules, mistakes,
// goals and a trade timeline. And when it grew to twelve, twelve identical
// tiles read as noise -- the eye has nowhere to land and skips the section
// whole. Varying the spans gives the block a shape: two anchors, then rows
// that alternate rhythm, so it scans as a composition rather than a list.
//
// **The Free / Paid pills are load-bearing.** Listing everything only works
// if the reader can tell at a glance which side of the line each item is on;
// an unlabelled list of twelve, five of them gated, is a paywall waiting to
// ambush somebody. Every "Paid" here is a feature `isPaidUser` actually gates
// and every "Free" is one it does not -- advertise a free feature as paid and
// you lose a signup, advertise a paid one as free and you lose a customer.

interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
  paid?: boolean;
  /** Tailwind span class for the lg bento. Absent means a single cell. */
  span?: string;
}

const FEATURES: Feature[] = [
  {
    icon: ClipboardCheck,
    title: "Trading rules",
    description:
      "“Stop must be set”. “Risk under 1%”. “Never move the stop”. Every trade comes back pass or fail. If a rule can't be checked the app says so, and leaves it out of your score instead of counting it as a pass.",
    span: "lg:col-span-2",
  },
  {
    icon: Sparkles,
    title: "AI trade review",
    description:
      "Any closed trade scored on execution rather than outcome, against your own history. Runs on your own API key. Free provider tiers are plenty.",
    paid: true,
    span: "lg:col-span-2",
  },

  {
    icon: AlertTriangle,
    title: "Mistake tracking",
    description: "Catches the stop you moved and the position you sized up, without you tagging it.",
  },
  {
    icon: Target,
    title: "Goals",
    description: "Measured from your real trades. You never tick one off yourself.",
  },
  {
    icon: LineChart,
    title: "Analytics",
    description: "Equity, drawdown, win rate, profit factor, expectancy, streaks.",
  },
  {
    icon: History,
    title: "History & timeline",
    description: "Every edit snapshotted, replayed in order, and restorable.",
  },

  {
    icon: Compass,
    title: "Find my edge",
    description:
      "Setup, ticker, direction, day, hold time, even the mood you logged. Ranked by expectancy, each with the trades behind it.",
    paid: true,
    span: "lg:col-span-2",
  },
  {
    icon: Ruler,
    title: "MAE / MFE",
    description:
      "How far each trade went against you before it worked, and how much of the move you actually captured.",
    paid: true,
    span: "lg:col-span-2",
  },

  {
    icon: NotebookPen,
    title: "Full trade tracker",
    description: "Screenshots, notes and custom fields you define. Autosaves as you type.",
  },
  {
    icon: ArrowLeftRight,
    title: "Import & export",
    description: "CSV, Excel, JSON, plus screenshot OCR that fills the form for you.",
  },
  {
    icon: CalendarRange,
    title: "AI period review",
    description: "Your week or month: biggest edge, biggest leak, three priorities.",
    paid: true,
  },
  {
    icon: FileText,
    title: "Printable reports",
    description: "Your month as a document. Prints straight to PDF.",
    paid: true,
  },
];

export function FeatureGrid() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 pb-24 sm:px-10">
      <div className="grid auto-rows-fr gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((feature, i) => (
          <motion.div
            key={feature.title}
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.35, delay: (i % 4) * 0.06, ease: "easeOut" }}
            className={`flex flex-col gap-3 rounded-2xl border p-5 sm:p-6 ${feature.span ?? ""} ${
              feature.paid
                ? "border-primary/25 bg-primary/[0.03] dark:bg-primary/[0.04]"
                : "border-zinc-200 bg-white dark:border-subtle dark:bg-card"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <feature.icon className="h-[18px] w-[18px]" strokeWidth={2} />
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                  feature.paid
                    ? "border-primary/40 text-primary"
                    : "border-zinc-200 text-zinc-400 dark:border-subtle dark:text-zinc-500"
                }`}
              >
                {feature.paid ? "Paid" : "Free"}
              </span>
            </div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">{feature.title}</h3>
            <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              {feature.description}
            </p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
