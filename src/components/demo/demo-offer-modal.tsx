"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { BrandMark } from "@/components/brand-mark";
import { useDialog } from "@/lib/a11y/use-dialog";

// "Start with a demo journal?" -- asked once, on the first login, before the
// welcome tour (Phase 4D; Alon's flow, 2026-09-28). Both answers are final:
// "No" means it's never offered again, and "Yes" gives a sandbox the user
// later swaps for their own journal exactly once. The copy says so, because
// neither can be undone.
//
// Escape does nothing here, unlike the welcome modal: it would have to mean
// one of the two answers, and both are permanent.
export function DemoOfferModal({ onDone }: { onDone: () => void }) {
  const titleId = useId();
  const yesRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState<"start" | "decline" | null>(null);
  const [failed, setFailed] = useState(false);
  const dialogRef = useDialog({ open: true, onClose: () => {}, closeOnEscape: false, initialFocusRef: yesRef });

  async function answer(action: "start" | "decline") {
    setBusy(action);
    setFailed(false);
    try {
      const res = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      // 409: already answered (another tab, a double click). Either way the
      // question is settled, so carry on rather than trap the user here.
      if (!res.ok && res.status !== 409) throw new Error(String(res.status));
      if (action === "start") router.refresh();
      onDone();
    } catch {
      if (action === "decline") {
        // Not recorded, so it will be asked again next time -- better than
        // blocking the whole app on a failed request.
        onDone();
        return;
      }
      setFailed(true);
      setBusy(null);
    }
  }

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
            Start with a demo journal?
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            About sixty sample trades on real market prices, with strategies, rules and notes, so every page has
            something to show. It&apos;s yours to explore and edit.
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            When you&apos;re ready, one click swaps it for your own empty journal. You can only do that once.
          </p>
        </div>
        {failed && (
          <p role="alert" className="text-sm text-loss">
            Couldn&apos;t set up the demo journal. Try again, or start empty.
          </p>
        )}
        <div className="mt-2 flex w-full flex-col gap-2">
          <button
            ref={yesRef}
            onClick={() => answer("start")}
            disabled={busy !== null}
            className="w-full rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-60 dark:text-zinc-950"
          >
            {busy === "start" ? "Setting it up…" : "Yes, show me a demo journal"}
          </button>
          <button
            onClick={() => answer("decline")}
            disabled={busy !== null}
            className="w-full rounded-lg px-5 py-2.5 text-sm text-zinc-500 hover:text-zinc-900 disabled:opacity-60 dark:hover:text-zinc-100"
          >
            No thanks, start empty
          </button>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            If you start empty, the demo won&apos;t be offered again.
          </p>
        </div>
      </div>
    </motion.div>
  );
}
