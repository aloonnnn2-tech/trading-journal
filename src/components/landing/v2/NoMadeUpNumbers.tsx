import { AlertTriangle } from "lucide-react";
import { Reveal } from "@/components/motion/Reveal";
import { MIN_COMPARISON_SAMPLE } from "@/lib/mistakes/analyze";

// "No made-up numbers" (Phase 3C of docs/design-audit.md, target order #8).
//
// The sample card is one row of the free Mistakes panel on /insights in its
// withheld state, in the app's own words (src/app/insights/mistake-tracker.tsx).
// The minimum is the app's constant, imported rather than typed, so the card
// can't drift from what the app actually does. "Oversized position" is one of
// the mistakes the app detects on its own; the 3-trade count is illustrative,
// which the caption says.

export function NoMadeUpNumbers() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 sm:px-10">
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
          <Reveal as="span" className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
            No made-up numbers
          </Reveal>
          <Reveal delay={0.05}>
            <h2 className="mt-4 text-3xl font-bold tracking-heading text-zinc-900 dark:text-zinc-50 sm:text-4xl lg:text-h2">
              Every number comes from your trades. If we can’t compute it, we say so.
            </h2>
          </Reveal>
        </div>

        <Reveal as="figure" className="m-0">
          <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-subtle dark:bg-card sm:p-6">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Mistakes</p>
            <div className="mt-4 rounded-lg border border-zinc-200 p-4 dark:border-subtle">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Oversized position</span>
                  <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-[10px] uppercase tracking-wider text-zinc-500 dark:border-zinc-700">
                    detected
                  </span>
                </div>
                <span className="tnum font-mono text-sm text-zinc-600 dark:text-zinc-400">3 trades</span>
              </div>
              <p className="mt-2 flex items-start gap-2 text-sm text-zinc-500">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" strokeWidth={2} aria-hidden />
                <span>
                  Not enough trades on both sides to compare performance yet. Needs at least{" "}
                  {MIN_COMPARISON_SAMPLE} with an R multiple in each group.
                </span>
              </p>
            </div>
          </div>
          <figcaption className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
            Sample card, in the app’s own words.
          </figcaption>
        </Reveal>
      </div>
    </section>
  );
}
