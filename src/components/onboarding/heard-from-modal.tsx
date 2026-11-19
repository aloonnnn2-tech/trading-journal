"use client";

import { useId, useRef, useState } from "react";
import { motion } from "framer-motion";
import { BrandMark } from "@/components/brand-mark";
import { useDialog } from "@/lib/a11y/use-dialog";
import { HEARD_FROM_OPTIONS, type HeardFromAnswer } from "@/lib/onboarding/heard-from";

// "How did you hear about us?" -- one tap, asked once on a new account's first
// sign-in, before the demo question (Alon, 2026-11-19). Never a wall: Skip and
// Escape both move on, and a failed save moves on too rather than trapping the
// user on a survey.
export function HeardFromModal({ onDone }: { onDone: () => void }) {
  const titleId = useId();
  const firstRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState<HeardFromAnswer | null>(null);

  async function answer(value: HeardFromAnswer) {
    if (busy) return;
    setBusy(value);
    try {
      await fetch("/api/settings/heard-from", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: value }),
      });
    } catch {
      // Not saved: it will simply be asked again next sign-in.
    }
    onDone();
  }

  const dialogRef = useDialog({
    open: true,
    onClose: () => void answer("skipped"),
    closeOnEscape: busy === null,
    initialFocusRef: firstRef,
  });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
      className="dialog-backdrop fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="dialog-panel flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-2xl dark:border-subtle dark:bg-card"
      >
        <BrandMark className="h-10 w-10" />
        <div>
          <h1 id={titleId} className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            How did you hear about us?
          </h1>
          <p className="mt-2 text-sm text-zinc-500">One tap. It tells us where to keep posting.</p>
        </div>
        <div className="mt-1 grid w-full grid-cols-2 gap-2">
          {HEARD_FROM_OPTIONS.map((option, i) => (
            <button
              key={option.value}
              ref={i === 0 ? firstRef : undefined}
              type="button"
              onClick={() => answer(option.value)}
              disabled={busy !== null}
              className={`rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-60 ${
                busy === option.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-zinc-200 text-zinc-800 hover:border-primary hover:text-primary dark:border-subtle dark:text-zinc-100"
              } ${i === HEARD_FROM_OPTIONS.length - 1 ? "col-span-2" : ""}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => answer("skipped")}
          disabled={busy !== null}
          className="text-xs text-zinc-400 hover:text-zinc-700 disabled:opacity-60 dark:text-zinc-500 dark:hover:text-zinc-200"
        >
          Skip
        </button>
      </div>
    </motion.div>
  );
}
