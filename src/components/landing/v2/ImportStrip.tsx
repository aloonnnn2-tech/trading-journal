import { Check } from "lucide-react";

// "Confirmed working" imports, fifth in the target order (Phase 2C of
// docs/design-audit.md).
//
// Deliberately narrow, because the facts are. Screenshot import has been
// confirmed for exactly one broker and one asset class -- Interactive
// Brokers, stocks -- and that is all this names. No broker's CSV or XLSX
// export has been verified, so it says nothing about "exports from" anyone.
// See "Facts Alon supplies" and its "Important correction on imports".
export function ImportStrip() {
  return (
    <section aria-label="Confirmed imports" className="px-6 pb-6 sm:px-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 text-center">
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">Confirmed working:</span>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 dark:border-subtle dark:bg-card dark:text-zinc-200">
            <Check aria-hidden className="h-3.5 w-3.5 text-profit" strokeWidth={2.5} />
            Interactive Brokers screenshots (stocks)
          </span>
        </div>
        <p className="text-xs text-zinc-500">Manual entry works for any broker or market.</p>
      </div>
    </section>
  );
}
