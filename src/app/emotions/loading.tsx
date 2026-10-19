import { SkeletonCard, SkeletonHeading, SkeletonPage } from "@/components/route-skeleton";

// Shown the moment someone clicks through to Emotions, while the server builds
// the page. Without it the old page sat there unchanged for up to a second on
// the live site and the click looked ignored (measured 2026-10-16). Mirrors
// the page: heading, then the win-rate-by-emotion table, then the history list.
export default function EmotionsLoading() {
  return (
    <SkeletonPage>
      <SkeletonHeading />
      <SkeletonCard className="h-72" />
      <SkeletonCard className="h-64" />
    </SkeletonPage>
  );
}
