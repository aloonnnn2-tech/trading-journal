import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/auth";
import { listCommissionRules } from "@/lib/commissions/queries";
import { CommissionManager } from "./commission-manager";
import { TrackPageView } from "@/components/track-page-view";

export default async function CommissionsPage() {
  await requireUserId();
  const supabase = await createClient();

  const rules = await listCommissionRules(supabase);

  // The asset types in the user's own trades, offered as "Which trades?"
  // choices -- free text on the trade card, so they are whatever the user
  // has actually typed. RLS scopes this to the caller. Fails quiet: the form
  // still takes a typed type.
  const { data: typed } = await supabase
    .from("trades")
    .select("asset_type")
    .not("asset_type", "is", null)
    .limit(2000);
  const assetTypes = [
    ...new Map(
      (typed ?? [])
        .map((r) => String((r as { asset_type: string | null }).asset_type ?? "").trim())
        .filter(Boolean)
        .map((t) => [t.toLowerCase(), t] as const),
    ).values(),
  ].sort((a, b) => a.localeCompare(b));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-5 sm:p-8">
      <TrackPageView event="commissions_viewed" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Commissions</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          What your broker charges. Every trade&apos;s profit and loss is recorded after these fees, and each trade shows
          the price it has to reach to break even.
        </p>
      </div>
      <CommissionManager initialRules={rules} assetTypes={assetTypes} />
    </div>
  );
}
