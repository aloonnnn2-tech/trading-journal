"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useDialog } from "@/lib/a11y/use-dialog";
import { useAnalytics } from "@/lib/tracking/useAnalytics";
import { isPromptPage } from "@/lib/reviews/prompt";
import type { ReviewSource } from "@/lib/reviews/types";
import { REVIEW_WOW_EVENT } from "@/lib/reviews/signals";
import { StarInput } from "./StarInput";
import { ReviewForm } from "./ReviewForm";

// "Enjoying Trading Lens?" -- a small corner card, asked at the moments Alon
// chose (src/lib/reviews/prompt.ts decides when). Never over the tour, a
// dialog or the paid-plan card, never twice in a session, and only on the
// overview pages: never while someone is in the middle of a form.

const ASKED_KEY = "tl-review-asked";
const CHECKED_KEY = "tl-review-checked";

function session(key: string, set?: boolean): boolean {
  try {
    if (set) sessionStorage.setItem(key, "1");
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

/** Nothing else is asking for the user's attention right now. */
function calm(): boolean {
  if (document.documentElement.dataset.tour === "active") return false;
  if (document.querySelector('[role="dialog"]')) return false;
  if (document.querySelector('[aria-label="Paid plan tour offer"]')) return false;
  return isPromptPage(window.location.pathname);
}

export function ReviewPrompt() {
  const pathname = usePathname();
  const { track } = useAnalytics();
  const [source, setSource] = useState<ReviewSource | null>(null);
  const [rating, setRating] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const waiting = useRef<number | null>(null);

  const record = (action: "shown" | "snoozed" | "dismissed") =>
    fetch("/api/reviews/prompt", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => {});

  // Shows the card once things are calm: checks every 2s for up to a minute,
  // so a wow moment's card waits for the import dialog to close.
  const showWhenCalm = useCallback(
    (why: ReviewSource) => {
      if (session(ASKED_KEY) || waiting.current !== null) return;
      let tries = 0;
      const attempt = () => {
        waiting.current = null;
        if (session(ASKED_KEY)) return;
        if (calm()) {
          session(ASKED_KEY, true);
          setSource(why);
          void record("shown");
          track("review_prompt_shown", { source: why });
          return;
        }
        if (++tries < 30) waiting.current = window.setTimeout(attempt, 2000);
      };
      waiting.current = window.setTimeout(attempt, 1500);
    },
    [track],
  );

  // The database triggers: once per browser session, on an overview page.
  useEffect(() => {
    if (!isPromptPage(pathname) || session(CHECKED_KEY) || session(ASKED_KEY)) return;
    session(CHECKED_KEY, true);
    fetch("/api/reviews/prompt")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { trigger: ReviewSource | null } | null) => {
        if (body?.trigger) showWhenCalm(body.trigger);
      })
      .catch(() => {});
  }, [pathname, showWhenCalm]);

  // The "wow" moments: the screenshot import and the AI review announce
  // themselves; the server still decides whether asking is allowed.
  useEffect(() => {
    const onWow = (e: Event) => {
      const why = (e as CustomEvent<{ source?: ReviewSource }>).detail?.source;
      if (!why || session(ASKED_KEY)) return;
      fetch("/api/reviews/prompt")
        .then((r) => (r.ok ? r.json() : null))
        .then((body: { mayAsk?: boolean } | null) => {
          if (body?.mayAsk) showWhenCalm(why);
        })
        .catch(() => {});
    };
    window.addEventListener(REVIEW_WOW_EVENT, onWow);
    return () => {
      window.removeEventListener(REVIEW_WOW_EVENT, onWow);
      if (waiting.current !== null) window.clearTimeout(waiting.current);
    };
  }, [showWhenCalm]);

  const close = () => {
    setSource(null);
    setDialogOpen(false);
  };

  return (
    <>
      <AnimatePresence>
        {source && !dialogOpen && (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            aria-label="Rate Trading Lens"
            className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-3 z-40 w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border border-primary/30 bg-white/95 p-4 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.45)] backdrop-blur-md dark:bg-card/95 sm:bottom-4 sm:right-4"
          >
            <button
              type="button"
              onClick={() => {
                void record("snoozed");
                track("review_prompt_snoozed", {});
                close();
              }}
              aria-label="Not now"
              className="absolute right-2 top-2 rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
            <p className="pr-6 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Enjoying Trading Lens?</p>
            <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">How would you rate it? It takes a few seconds.</p>
            <div className="mt-3">
              <StarInput
                value={rating}
                onChange={(n) => {
                  setRating(n);
                  setDialogOpen(true);
                }}
                label="Rate Trading Lens"
              />
            </div>
            <div className="mt-3 flex gap-3 text-xs">
              <button
                type="button"
                data-track="review-prompt-not-now"
                onClick={() => {
                  void record("snoozed");
                  track("review_prompt_snoozed", {});
                  close();
                }}
                className="text-zinc-600 hover:underline dark:text-zinc-400"
              >
                Not now
              </button>
              <button
                type="button"
                data-track="review-prompt-never"
                onClick={() => {
                  void record("dismissed");
                  track("review_prompt_dismissed", {});
                  close();
                }}
                className="text-zinc-500 hover:underline"
              >
                Don&apos;t ask again
              </button>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
      {source && <ReviewDialog open={dialogOpen} source={source} rating={rating} onClose={close} />}
    </>
  );
}

function ReviewDialog({ open, source, rating, onClose }: { open: boolean; source: ReviewSource; rating: number; onClose: () => void }) {
  const titleId = useId();
  const dialogRef = useDialog({ open, onClose });
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, pointerEvents: "auto" }}
          // Click-through while it fades out, so it can't swallow the next click.
          exit={{ opacity: 0, pointerEvents: "none" }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border border-zinc-200 bg-white p-5 outline-none dark:border-subtle dark:bg-card sm:max-w-md sm:rounded-2xl sm:p-6"
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute right-3 top-3 rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
            <h2 id={titleId} className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Rate Trading Lens
            </h2>
            <ReviewForm initial={null} initialRating={rating} source={source} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
