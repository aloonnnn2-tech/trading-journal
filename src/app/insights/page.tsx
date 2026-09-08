import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/auth";
import { getInsights } from "@/lib/insights/queries";
import { getMistakeReport } from "@/lib/mistakes/queries";
import { getEdgeReport } from "@/lib/edge/queries";
import { isPaidUser } from "@/lib/settings/plan";
import { getUserSettings } from "@/lib/settings/queries";
import { InsightChart } from "./insight-chart";
import { Card } from "@/components/ui/Card";
import { MistakeTracker } from "./mistake-tracker";
import { EdgePanel, EdgeUpsell } from "./edge-panel";

export default async function InsightsPage() {
  const userId = await requireUserId();
  const supabase = await createClient();

  const settings = await getUserSettings(supabase, userId);
  // Find My Edge is the paid layer; everything above it on this page stays
  // free and unchanged. The report is only fetched for paid users -- it reads
  // the whole journal, and there is no reason to spend that on a page that
  // will render an upsell card instead.
  const paid = isPaidUser(settings);

  const [insights, mistakes, edge] = await Promise.all([
    getInsights(supabase, settings.timezone),
    // Degrades to an empty report rather than taking the page down: it reads
    // strategy_rules (0033) and the Mistakes field (0034), either of which may
    // not be applied yet on a given environment.
    getMistakeReport(supabase).catch(() => ({
      summaries: [],
      tradesAnalysed: 0,
      nothingTagged: true,
    })),
    paid ? getEdgeReport(supabase, settings.timezone) : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-6 sm:p-8">
      <div data-tour-id="insights-header">
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

      {/* The deviation list above is the reason to open this page; these two
          deeper reads follow it. */}
      <section className="flex flex-col gap-2" data-tour-id="tour-mistakes">
        <MistakeTracker
          summaries={mistakes.summaries}
          tradesAnalysed={mistakes.tradesAnalysed}
          nothingTagged={mistakes.nothingTagged}
        />
      </section>

      <section className="flex flex-col gap-2" data-tour-id="tour-edge">
        {edge ? (
          <EdgePanel
            edges={edge.edges}
            leaks={edge.leaks}
            overallExpectancy={edge.overallExpectancy}
            tradesAnalysed={edge.tradesAnalysed}
            excludedForSample={edge.excludedForSample}
          />
        ) : (
          <EdgeUpsell />
        )}
      </section>
    </div>
  );
}
