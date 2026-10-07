import { SkeletonCard, SkeletonHeading, SkeletonPage } from "@/components/route-skeleton";

// Its own loading screen, so the trade list's (src/app/trades/loading.tsx)
// doesn't show here in the wrong shape.
export default function ImportLoading() {
  return (
    <SkeletonPage>
      <SkeletonHeading />
      <SkeletonCard className="h-64" />
    </SkeletonPage>
  );
}
