import { SkeletonBar, SkeletonCard, SkeletonHeading, SkeletonPage } from "@/components/route-skeleton";

// Shown while the server renders /trades. Mirrors the page: title with the
// action buttons (desktop only, as on the real page), the status tabs, the
// summary strip, then the table.
//
// /trades/[id] and /trades/import have loading screens of their own: this
// one would otherwise also show, in the wrong shape, while they load.
export default function TradesLoading() {
  return (
    <SkeletonPage>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SkeletonHeading subtitle={false} />
        <div className="hidden gap-3 sm:flex">
          <SkeletonBar className="h-9 w-24" />
          <SkeletonBar className="h-9 w-24" />
          <SkeletonBar className="h-9 w-32" />
        </div>
      </div>
      <SkeletonBar className="h-7 w-64 max-w-full" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} className="h-[72px]" />
        ))}
      </div>
      <SkeletonCard className="h-96" />
    </SkeletonPage>
  );
}
