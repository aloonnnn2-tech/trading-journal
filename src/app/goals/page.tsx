import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/auth";
import { getUserSettings } from "@/lib/settings/queries";
import { getGoalProgress } from "@/lib/goals/queries";
import { getMistakeReport } from "@/lib/mistakes/queries";
import { GoalManager } from "./goal-manager";

export default async function GoalsPage() {
  const userId = await requireUserId();
  const supabase = await createClient();
  const settings = await getUserSettings(supabase, userId);

  // Both degrade to empty rather than breaking the page: goals reads a
  // hand-applied migration (0036), and the mistake labels read 0033/0034.
  const [progress, mistakes] = await Promise.all([
    getGoalProgress(supabase, settings.timezone).catch(() => []),
    getMistakeReport(supabase).catch(() => ({
      summaries: [],
      tradesAnalysed: 0,
      nothingTagged: true,
    })),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6 sm:p-8">
      <div>
        <h1
            data-tour-id="tour-goals"
            className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
          Goals
        </h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Commitments measured from your own trades. Every goal here is something the app can
          count. Nothing is ticked off by hand, and nothing is scored by guesswork.
        </p>
      </div>

      <GoalManager
        initialProgress={progress}
        mistakeLabels={mistakes.summaries.map((s) => s.label)}
      />
    </div>
  );
}
