import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/auth";
import { getShowTradeSummary } from "@/lib/settings/trade-summary";
import { TrackPageView } from "@/components/track-page-view";
import { SettingsForm } from "./settings-form";

// Setup -> Settings: what the app shows you and how it behaves (Alon,
// 2026-09-29). The summary strip has its own column (0052); every other
// switch lives in user_settings.preferences (0054) and reaches the page
// through PreferencesProvider in the root layout.
export default async function SettingsPage() {
  const userId = await requireUserId();
  const supabase = await createClient();
  // null: migration 0052 isn't applied yet, so there's nowhere to save it.
  const showTradeSummary = await getShowTradeSummary(supabase, userId).catch(() => null);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-5 sm:p-8">
      <TrackPageView event="settings_viewed" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Settings</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Choose what the app shows you.</p>
      </div>
      <SettingsForm initialShowTradeSummary={showTradeSummary} />
    </div>
  );
}
