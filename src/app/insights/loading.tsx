import { SkeletonCard, SkeletonHeading, SkeletonPage } from "@/components/route-skeleton";

// Shown while the server renders /insights. Mirrors the page: heading, then
// the two-column grid of pattern panels (Mistakes first).
export default function InsightsLoading() {
  return (
    <SkeletonPage>
      <SkeletonHeading />
      <div className="grid gap-6 lg:grid-cols-2">
        <SkeletonCard className="h-72" />
        <SkeletonCard className="h-72" />
        <SkeletonCard className="h-56" />
        <SkeletonCard className="h-56" />
      </div>
    </SkeletonPage>
  );
}
