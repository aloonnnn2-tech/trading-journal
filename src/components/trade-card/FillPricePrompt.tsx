"use client";

import { useId, useState } from "react";
import { CircleDollarSign } from "lucide-react";
import { formatFillPrice, outsideFillRange, type FillQuestion } from "@/lib/trades/fill-check";

// "Your buy stop-limit order is open. At what price did it fill?" -- shown on
// the trade card until answered (rules in src/lib/trades/fill-check.ts).
// The box starts on the price the app assumed; "That's right" keeps it.
export function FillPricePrompt({
  question,
  onAnswer,
}: {
  question: FillQuestion;
  /** The fill price the user gave, or null to keep the assumed one. */
  onAnswer: (price: number | null) => Promise<void>;
}) {
  const id = useId();
  const [draft, setDraft] = useState(question.assumed != null ? String(question.assumed) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const price = Number(draft);
  const valid = draft.trim() !== "" && Number.isFinite(price) && price > 0;
  const changed = valid && price !== question.assumed;
  const unusual = valid && outsideFillRange(price, question.range);

  async function answer(value: number | null) {
    setBusy(true);
    setError(null);
    try {
      await onAnswer(value);
    } catch {
      setError("Couldn't save that. Try again.");
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby={`${id}-q`}
      className="rounded-xl border border-amber-500/40 bg-amber-500/[0.07] px-4 py-3.5"
    >
      <div className="flex items-start gap-3">
        <CircleDollarSign className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" strokeWidth={2} />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">{question.heading}</p>
          <h2 id={`${id}-q`} className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">
            At what price did it fill?
          </h2>
          {question.hint && <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{question.hint}</p>}

          <form
            className="mt-3 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) void answer(changed ? price : null);
            }}
          >
            <label htmlFor={`${id}-price`} className="sr-only">
              Fill price
            </label>
            <input
              id={`${id}-price`}
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
              className="w-36 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 font-mono text-sm text-zinc-900 outline-none focus:border-primary disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
            <button
              type="submit"
              data-track="fill-price-save"
              disabled={!valid || busy}
              className="rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50 dark:text-zinc-950"
            >
              {changed ? "Save fill price" : "Confirm"}
            </button>
            {question.assumed != null && changed && (
              <button
                type="button"
                data-track="fill-price-keep"
                disabled={busy}
                onClick={() => void answer(null)}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
              >
                Keep {formatFillPrice(question.assumed)}
              </button>
            )}
          </form>
          <p aria-live="polite" className="mt-1.5 min-h-4 text-xs">
            {error ? (
              <span className="text-loss">{error}</span>
            ) : unusual ? (
              <span className="text-amber-700 dark:text-amber-300">
                That&apos;s outside where this order normally fills. Save it anyway if that&apos;s what your broker shows.
              </span>
            ) : changed ? (
              <span className="text-zinc-500">P/L and R are recalculated from the new entry.</span>
            ) : null}
          </p>
        </div>
      </div>
    </section>
  );
}
