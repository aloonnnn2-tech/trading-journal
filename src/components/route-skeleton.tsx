import type { ReactNode } from "react";

// Building blocks for route loading screens (a page's loading.tsx). Grey
// shapes only -- never a figure, a name or a count, so nothing on a loading
// screen can say something untrue (docs/design-audit.md, "the one rule").
// Same vocabulary as src/app/dashboard/loading.tsx and analytics/loading.tsx.

/**
 * The page frame. `data-route-loading` tells the guided tour the page is still
 * on its way, so it waits instead of reporting a step's target as missing
 * (pageStillLoading() in src/components/tour/tour-overlay.tsx).
 */
export function SkeletonPage({ children }: { children: ReactNode }) {
  return (
    <div data-route-loading className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-5 sm:p-8">
      {children}
    </div>
  );
}

/** A page title with its one-line description underneath. */
export function SkeletonHeading({ subtitle = true }: { subtitle?: boolean }) {
  return (
    <div className="animate-pulse">
      <div className="h-7 w-32 rounded-md bg-zinc-200 dark:bg-zinc-800" />
      {subtitle && <div className="mt-2 h-4 w-72 max-w-full rounded-md bg-zinc-100 dark:bg-zinc-800/60" />}
    </div>
  );
}

export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-xl border border-zinc-200 bg-white p-5 shadow-[0_1px_2px_rgba(28,27,24,0.05)] dark:border-subtle dark:bg-card ${className}`}
    >
      <div className="h-full w-full rounded-lg bg-zinc-100 dark:bg-zinc-800/60" />
    </div>
  );
}

/** A plain bar, for a row of buttons or tabs. */
export function SkeletonBar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800/60 ${className}`} />;
}
