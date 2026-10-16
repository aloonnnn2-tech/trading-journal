import { SkeletonCard, SkeletonHeading, SkeletonPage } from "@/components/route-skeleton";

// Shown the moment someone clicks through to Fields, while the server builds
// the page. Without it the old page sat there unchanged for up to a second on
// the live site and the click looked ignored (measured 2026-10-16). Mirrors
// the page: heading, then built-in fields, custom fields, then folders.
export default function FieldsLoading() {
  return (
    <SkeletonPage>
      <SkeletonHeading />
      <SkeletonCard className="h-72" />
      <SkeletonCard className="h-64" />
      <SkeletonCard className="h-32" />
    </SkeletonPage>
  );
}
