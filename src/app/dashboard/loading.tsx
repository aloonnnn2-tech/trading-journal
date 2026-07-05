function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-xl border border-zinc-200 bg-white p-5 shadow-[0_1px_2px_rgba(28,27,24,0.05)] dark:border-subtle dark:bg-card ${className}`}
    >
      <div className="h-full w-full rounded-lg bg-zinc-100 dark:bg-zinc-800/60" />
    </div>
  );
}

export default function DashboardLoading() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-6 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="animate-pulse">
          <div className="h-7 w-40 rounded-md bg-zinc-200 dark:bg-zinc-800" />
          <div className="mt-2 h-4 w-32 rounded-md bg-zinc-100 dark:bg-zinc-800/60" />
        </div>
        <div className="h-9 w-28 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonCard key={i} className="h-[92px]" />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SkeletonCard className="h-72 lg:col-span-2" />
        <SkeletonCard className="h-72" />
        <SkeletonCard className="h-64" />
        <SkeletonCard className="h-64" />
        <SkeletonCard className="h-64" />
      </div>
    </div>
  );
}
