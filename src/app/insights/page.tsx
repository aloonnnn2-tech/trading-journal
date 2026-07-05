import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getInsights } from "@/lib/insights/queries";
import { getUserSettings } from "@/lib/settings/queries";
import { InsightChart } from "./insight-chart";
import { Card } from "@/components/ui/Card";

export default async function InsightsPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/sign-in");

  const settings = await getUserSettings(supabase, data.user.id);
  const insights = await getInsights(supabase, settings.timezone);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-6 sm:p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Insights</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Patterns detected across your closed trades. Each insight needs at least 5 trades in a
          segment and a win rate that differs meaningfully from your overall average.
        </p>
      </div>

      {insights.length === 0 ? (
        <Card className="text-sm text-zinc-500">Not enough closed trade data yet to detect any patterns.</Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {insights.map((insight) => (
            <Card key={insight.id} hoverable={false}>
              <div className="flex items-start gap-2.5">
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold ${
                    insight.direction === "positive"
                      ? "bg-profit/10 text-profit"
                      : "bg-loss/10 text-loss"
                  }`}
                >
                  {insight.direction === "positive" ? "▲" : "▼"}
                </span>
                <div>
                  <p className="text-sm font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
                    {insight.text}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {insight.trades} trades vs. {(insight.overallWinRate * 100).toFixed(0)}% overall win rate
                  </p>
                </div>
              </div>
              <div className="mt-3">
                <InsightChart data={insight.chart} highlightLabel={insight.segmentLabel} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
