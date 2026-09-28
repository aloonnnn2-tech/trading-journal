import type { SummaryFigure } from "@/lib/trades/summary-strip";

// The summary strip above the trade table (Phase 4B). Server-rendered: the
// figures come in with the page and change only when the filters do. The
// logic -- which figure can be shown, and why not -- is in
// src/lib/trades/summary-strip.ts.
//
// A figure that can't be given is "—", with the reason on hover (title) and
// the same reason as text for screen readers, where a title isn't read
// reliably.

export function SummaryStrip({ figures }: { figures: SummaryFigure[] }) {
  return (
    <dl
      aria-label="Summary of the filtered closed trades"
      className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 dark:border-subtle dark:bg-subtle sm:grid-cols-3 lg:grid-cols-6"
    >
      {figures.map((figure) => (
        <div key={figure.key} className="flex flex-col gap-1 bg-white px-4 py-3 dark:bg-card">
          <dt className="text-xs uppercase tracking-wide text-zinc-500">{figure.label}</dt>
          <dd className="tnum font-mono text-lg font-semibold">
            {figure.value !== null ? (
              <span
                className={
                  figure.tone === "profit"
                    ? "text-profit"
                    : figure.tone === "loss"
                      ? "text-loss"
                      : "text-zinc-900 dark:text-zinc-50"
                }
              >
                {figure.value}
              </span>
            ) : (
              <span title={figure.reason} className="cursor-help text-zinc-400 dark:text-zinc-600">
                <span aria-hidden>—</span>
                <span className="sr-only">Not shown: {figure.reason}</span>
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
