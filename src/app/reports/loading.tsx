import { SkeletonBar, SkeletonCard, SkeletonHeading, SkeletonPage } from "@/components/route-skeleton";

// Shown the moment someone clicks through to Reports, while the server builds
// the page. Without it the old page sat there unchanged for up to a second on
// the live site and the click looked ignored (measured 2026-10-16). Mirrors
// the page: heading, then the period buttons, then the report itself.
export default function ReportsLoading() {
  return (
    <SkeletonPage>
      <SkeletonHeading />
      <div className="flex gap-2"><SkeletonBar className="h-8 w-24" /><SkeletonBar className="h-8 w-24" /><SkeletonBar className="h-8 w-24" /></div>
      <SkeletonCard className="h-96" />
    </SkeletonPage>
  );
}
