"use client";

import { motion } from "framer-motion";
import { BrandMark } from "@/components/brand-mark";

// Shown once, on the very first login after signup (gated by
// has_completed_tour, see tour-overlay.tsx). Full-viewport and above
// everything else in the stacking order -- the point is nothing is
// touchable until the user answers.
export function WelcomeModal({
  onAccept,
  onDecline,
}: {
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.25, delay: 0.05 }}
        className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-zinc-200 dark:border-subtle bg-white dark:bg-card p-8 text-center shadow-2xl"
      >
        <BrandMark className="h-10 w-10" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Welcome to Trading Lens
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Thanks for joining. Want a quick tour of the app before you dive in?
          </p>
        </div>
        <div className="mt-2 flex w-full flex-col gap-2">
          <button
            onClick={onAccept}
            className="w-full rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white dark:text-zinc-950 hover:brightness-110"
          >
            Take the 2-minute tour
          </button>
          <button
            onClick={onDecline}
            className="w-full rounded-lg px-5 py-2.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            I&apos;ll explore on my own
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
