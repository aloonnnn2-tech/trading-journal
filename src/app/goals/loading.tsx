import { SkeletonCard, SkeletonHeading, SkeletonPage } from "@/components/route-skeleton";

// Shown the moment someone clicks through to Goals, while the server builds
// the page. Without it the old page sat there unchanged for up to a second on
// the live site and the click looked ignored (measured 2026-10-16). Mirrors
// the page: heading, then goals and how each one is scored.
export default function GoalsLoading() {
  return (
    <SkeletonPage>
      <SkeletonHeading />
      <SkeletonCard className="h-40" />
      <SkeletonCard className="h-40" />
      <SkeletonCard className="h-32" />
    </SkeletonPage>
  );
}
