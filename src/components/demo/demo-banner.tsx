"use client";

import { useId, useRef, useState } from "react";
import { FlaskConical } from "lucide-react";
import { useDialog } from "@/lib/a11y/use-dialog";

// Shown on every app page while the demo journal is in the account (Phase
// 4D), so it's never mistaken for real results -- the spec's "clearly
// labelled". Carries the one-time switch to the user's own journal, behind a
// confirmation that says exactly what it clears.
export function DemoBanner() {
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <div
        data-demo-banner
        className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-900 dark:text-amber-200 print:hidden"
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
          <p className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 shrink-0" aria-hidden />
            <span>
              You&apos;re exploring a <strong className="font-semibold">demo journal</strong>. Its trades are samples on
              real market prices, not your results.
            </span>
          </p>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-lg border border-amber-600/40 px-3 py-1 text-sm font-medium hover:bg-amber-500/15"
          >
            Switch to my own journal
          </button>
        </div>
      </div>
      {confirming && <ConfirmSwitch onCancel={() => setConfirming(false)} />}
    </>
  );
}

function ConfirmSwitch({ onCancel }: { onCancel: () => void }) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Focus starts on Cancel: the other button can't be undone.
  const dialogRef = useDialog({ open: true, onClose: onCancel, initialFocusRef: cancelRef });

  async function switchNow() {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "finish" }),
      });
      if (!res.ok && res.status !== 409) throw new Error(String(res.status));
      // A full load, not a soft refresh: every page and cache was built on the
      // demo's rows, and the one this banner sits on may be a demo trade that
      // no longer exists.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load is the point, see above
      window.location.href = "/dashboard";
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="dialog-panel w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-subtle dark:bg-card"
      >
        <h2 id={titleId} className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Switch to your own journal?
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          This clears the demo journal, including anything you added or changed while trying it: trades, strategies,
          rules and notes. Your settings stay.
        </p>
        <p className="mt-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
          The demo can&apos;t be brought back afterwards.
        </p>
        {failed && (
          <p role="alert" className="mt-3 text-sm text-loss">
            Couldn&apos;t switch. Nothing was cleared; try again.
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg px-4 py-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Keep exploring
          </button>
          <button
            type="button"
            onClick={switchNow}
            disabled={busy}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-60 dark:text-zinc-950"
          >
            {busy ? "Switching…" : "Clear the demo and switch"}
          </button>
        </div>
      </div>
    </div>
  );
}
