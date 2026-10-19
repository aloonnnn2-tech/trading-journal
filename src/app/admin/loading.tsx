import { SkeletonCard, SkeletonHeading, SkeletonPage } from "@/components/route-skeleton";

// Shown the moment someone clicks through to Admin, while the server builds
// the page. Without it the old page sat there unchanged for up to a second on
// the live site and the click looked ignored (measured 2026-10-16). Mirrors
// the page: heading, then whichever admin view is opening.
export default function AdminLoading() {
  return (
    <SkeletonPage>
      <SkeletonHeading />
      <SkeletonCard className="h-32" />
      <SkeletonCard className="h-80" />
    </SkeletonPage>
  );
}
