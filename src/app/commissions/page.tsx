import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/auth";
import { listCommissionRules } from "@/lib/commissions/queries";
import { CommissionManager } from "./commission-manager";
import { TrackPageView } from "@/components/track-page-view";

export default async function CommissionsPage() {
  await requireUserId();
  const supabase = await createClient();

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
          those fees. Pick your broker to start from its published prices, or build your own. Each
          trade shows two prices: with a $2.50-a-side fee, one share bought at $80 covers the buy fee
          at $82.50 and breaks even after both fees at $85.00 — that line shows up on the chart.
        </p>
      </div>
      <CommissionManager initialRules={rules} />
    </div>
  );
}
