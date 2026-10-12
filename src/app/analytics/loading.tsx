// Shown while the server renders /analytics.
//
// That page awaits one Promise.all of five Supabase round-trips before it
// returns anything, so without a loading file the browser sat on the previous
// page and then swapped in a finished one -- read as a blank page for a
// second or two (issue 4 of docs/design-audit.md). The other half of that fix
// was the stat tiles, which used to fade in one at a time on top of the wait;
// see src/components/motion/StaggerGrid.tsx.
//
// Deliberately mirrors the real page's grid shape -- six stat tiles, then the
// chart pair, then the panels -- so the layout does not jump when the content
// lands. Same skeleton vocabulary as src/app/dashboard/loading.tsx.

function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-xl border border-zinc-200 bg-white p-5 shadow-[0_1px_2px_rgba(28,27,24,0.05)] dark:border-subtle dark:bg-card ${className}`}
    >
      <div className="h-full w-full rounded-lg bg-zinc-100 dark:bg-zinc-800/60" />
    </div>
  );
}

export default function AnalyticsLoading() {
  return (
    // data-route-loading: tells the guided tour this page is still on its
    // way, so it does not report a step's target as missing while the real
    // page streams in. See pageStillLoading() in tour-overlay.tsx.
    <div data-route-loading className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-5 sm:p-8">
      <div className="animate-pulse">
        <div className="h-7 w-32 rounded-md bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-2 h-4 w-72 max-w-full rounded-md bg-zinc-100 dark:bg-zinc-800/60" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <SkeletonCard key={i} className="h-[92px]" />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SkeletonCard className="h-72 lg:col-span-2" />
        <SkeletonCard className="h-72" />
      </div>

      <SkeletonCard className="h-64" />
      <SkeletonCard className="h-64" />
    </div>
  );
}
