import { SkeletonCard, SkeletonHeading, SkeletonPage } from "@/components/route-skeleton";

// Shown while the server renders /strategies, so a click on it (from the menu
// or the guided tour, which preloads it) shows the page's frame at once.
// Mirrors the page: heading, the strategy list, then the add form.
export default function StrategiesLoading() {
  return (
    <SkeletonPage>
      <SkeletonHeading />
      <div className="flex flex-col gap-3">
        <SkeletonCard className="h-20" />
        <SkeletonCard className="h-20" />
      </div>
      <SkeletonCard className="h-48" />
    </SkeletonPage>
  );
}
