import { SkeletonBar, SkeletonCard, SkeletonPage } from "@/components/route-skeleton";

// Shown while a trade's page loads -- most often right after Quick trade
// creates one, where a slow first load used to look like nothing happened.
// Mirrors the page: back link, the trade's header fields, then its panels.
export default function TradeLoading() {
  return (
    <SkeletonPage>
      <SkeletonBar className="h-4 w-24" />
      <SkeletonCard className="h-40" />
      <div className="grid gap-6 lg:grid-cols-2">
        <SkeletonCard className="h-72" />
        <SkeletonCard className="h-72" />
      </div>
    </SkeletonPage>
  );
}
