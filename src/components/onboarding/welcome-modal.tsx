"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { BrandMark } from "@/components/brand-mark";
import { useDialog } from "@/lib/a11y/use-dialog";

// The first thing a new account sees (Alon, 2026-11-19): a welcome, and on the
// same card the one choice that shapes everything after it -- demo data or an
// empty journal. Then "How did you hear about us?", then "Log your first
// trade" (src/components/tour/tour-overlay.tsx runs the order).
//
// Both demo answers are final, as before (Phase 4D): "No" is never offered
// again, and "Yes" gives a sandbox the user swaps for their own journal once.
// So Escape does nothing while the question is on the card; without it (the
// demo isn't available, or was already answered) Escape just carries on.
export function WelcomeModal({
  offerDemo,
  demoKeepsTrades = false,
  onDone,
}: {
  offerDemo: boolean;
  /** Switching from the demo keeps trades the user logged (0082 applied). */
  demoKeepsTrades?: boolean;
  onDone: (choseDemo: boolean) => void;
}) {
  const titleId = useId();
  const firstRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState<"start" | "decline" | null>(null);
  const [failed, setFailed] = useState(false);
  const dialogRef = useDialog({
    open: true,
    onClose: () => {
      if (!offerDemo) onDone(false);
    },
    closeOnEscape: !offerDemo,
    initialFocusRef: firstRef,
  });

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
      onDone(action === "start");
    } catch {
      if (action === "decline") {
        // Not recorded, so it will be asked again next time -- better than
        // blocking the whole app on a failed request.
        onDone(false);
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
        className="dialog-panel flex max-h-[92vh] w-full max-w-md flex-col items-center gap-4 overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-2xl dark:border-subtle dark:bg-card"
      >
        <BrandMark className="h-10 w-10" />
        <div>
          <h1 id={titleId} className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Welcome to Trading Lenz
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Log your trades in seconds, see which setups actually pay, and catch the mistakes that cost you money.
          </p>
        </div>

        {offerDemo ? (
          <>
            <div className="w-full rounded-xl border border-zinc-200 p-4 text-left dark:border-subtle">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Want to use demo data first?</p>
              <p className="mt-1 text-sm text-zinc-500">
                About sixty sample trades on real market prices, so every page has something to show.{" "}
                {demoKeepsTrades
                  ? "When you're ready, one click removes the samples and keeps any trades you logged yourself. You can only do that once."
                  : "When you're ready, one click swaps it for your own empty journal. You can only do that once."}
              </p>
            </div>
            {failed && (
              <p role="alert" className="text-sm text-loss">
                Couldn&apos;t set up the demo data. Try again, or start empty.
              </p>
            )}
            <div className="flex w-full flex-col gap-2">
              <button
                ref={firstRef}
                onClick={() => answer("start")}
                disabled={busy !== null}
                className="w-full rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-60 dark:text-zinc-950"
              >
                {busy === "start" ? "Setting it up…" : "Yes, show me demo data"}
              </button>
              <button
                onClick={() => answer("decline")}
                disabled={busy !== null}
                className="w-full rounded-lg border border-zinc-200 px-5 py-2.5 text-sm text-zinc-700 hover:border-zinc-400 disabled:opacity-60 dark:border-subtle dark:text-zinc-200"
              >
                No thanks, start empty
              </button>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                If you start empty, the demo won&apos;t be offered again.
              </p>
            </div>
          </>
        ) : (
          <button
            ref={firstRef}
            onClick={() => onDone(false)}
            className="w-full rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white hover:brightness-110 dark:text-zinc-950"
          >
            Get started
          </button>
        )}

        <p className="text-xs text-zinc-400 dark:text-zinc-500">Want the guided tour? It&apos;s always under &ldquo;Guided tours&rdquo; in the menu.</p>
      </div>
    </motion.div>
  );
}
