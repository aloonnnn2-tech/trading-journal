import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listCommissionRules } from "@/lib/commissions/queries";
import { CommissionManager } from "./commission-manager";
import { TrackPageView } from "@/components/track-page-view";

export default async function CommissionsPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/sign-in");

  const rules = await listCommissionRules(supabase);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6 sm:p-8">
      <TrackPageView event="commissions_viewed" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Commissions
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Tell the journal what your broker charges and every trade&apos;s P/L is recorded net of
          those fees. Trades also get a break-even price — with a $2.50-a-side fee, one share bought
          at $90 doesn&apos;t turn a profit until $95, and that line shows up on the chart.
        </p>
      </div>
      <CommissionManager initialRules={rules} />
    </div>
  );
}
