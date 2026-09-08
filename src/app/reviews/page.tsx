import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/auth";
import { getUserSettings } from "@/lib/settings/queries";
import { isPaidUser } from "@/lib/settings/plan";
import { listApiKeys } from "@/lib/ai-keys/queries";
import { listConsentedProviders } from "@/lib/ai-keys/consent";
import { listPeriodReviews, stalePeriodReviewIds } from "@/lib/ai-reviews/queries";
import { Card } from "@/components/ui/Card";
import { ReviewsManager } from "./reviews-manager";

export default async function ReviewsPage() {
  const userId = await requireUserId();
  const supabase = await createClient();
  const settings = await getUserSettings(supabase, userId);

  if (!isPaidUser(settings)) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6 sm:p-8">
        <div>
          <h1
            data-tour-id="tour-reviews"
            className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
            AI Reviews
          </h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Your week or month, analysed for edges, leaks and habits.
          </p>
        </div>
        <Card hoverable={false} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            This is a paid-plan feature
          </h2>
          <p className="text-sm text-zinc-500">
            Pick a week, a month or a custom range and get it analysed: your biggest edge,
            your biggest leak, the behaviours behind them, and up to three priorities for
            next time. Runs on your own API key. Free options available.
          </p>
          <Link href="/#pricing" className="text-sm text-primary hover:underline">
            See plans
          </Link>
        </Card>
      </div>
    );
  }

  // Each falls back to empty rather than throwing: all three read tables added
  // by hand-applied migrations, and a pending one must degrade to an empty
  // state instead of a broken page. The generate route reports it properly.
  const [reviews, apiKeys, consentedProviders] = await Promise.all([
    listPeriodReviews(supabase).catch(() => []),
    listApiKeys(supabase).catch(() => []),
    listConsentedProviders(supabase).catch(() => []),
  ]);

  // One query for the whole list -- see stalePeriodReviewIds.
  const staleIds = await stalePeriodReviewIds(supabase, reviews, settings.timezone).catch(
    () => [],
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6 sm:p-8">
      <div>
        <h1
            data-tour-id="tour-reviews"
            className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
          AI Reviews
        </h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Your week or month, analysed for edges, leaks and habits. Judged on process, not
          just on profit.
        </p>
      </div>

      <ReviewsManager
        keys={apiKeys}
        initialConsents={consentedProviders}
        initialReviews={reviews}
        initialStaleIds={staleIds}
      />
    </div>
  );
}
