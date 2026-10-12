"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Star, X } from "lucide-react";

// "Leave a review", pinned bottom-right on the homepage, always there
// (Alon, 2026-10-12: the in-page button sat too far down to be found). The
// ✕ hides it for this page view only; a reload brings it back.
export function FloatingReviewButton() {
  const [hidden, setHidden] = useState(false);

  return (
    <AnimatePresence>
      {!hidden && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.2 }}
          className="fixed bottom-4 right-4 z-40 flex items-center gap-1 rounded-full border border-zinc-200 bg-white/95 py-1 pl-1 pr-1.5 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.35)] backdrop-blur-md dark:border-subtle dark:bg-card/95"
        >
          <Link
            href="/review?from=homepage"
            data-track="review-cta-floating"
            className="flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 text-sm font-medium text-white transition hover:bg-primary-hover dark:text-zinc-950"
          >
            <Star className="h-4 w-4 fill-current" strokeWidth={1.75} />
            Leave a review
          </Link>
          <button
            type="button"
            onClick={() => setHidden(true)}
            aria-label="Hide the review button"
            className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
