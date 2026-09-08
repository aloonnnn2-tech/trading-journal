import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/auth";
import { getUserSettings } from "@/lib/settings/queries";
import { isPaidUser } from "@/lib/settings/plan";
import { Card } from "@/components/ui/Card";
import { buildTradingReport, resolveReportPeriod, REPORT_PRESETS, type ReportPreset } from "@/lib/report/build";
import { ReportView } from "./report-view";

function isPreset(value: string | undefined): value is ReportPreset {
  return value !== undefined && (REPORT_PRESETS as readonly string[]).includes(value);
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const userId = await requireUserId();
  const supabase = await createClient();
  const settings = await getUserSettings(supabase, userId);

  if (!isPaidUser(settings)) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6 sm:p-8">
        <div>
          <h1
            data-tour-id="tour-reports"
            className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
            Reports
          </h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Your month as a document you can keep or share.
          </p>
        </div>
        <Card hoverable={false} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            This is a paid-plan feature
          </h2>
          <p className="text-sm text-zinc-500">
            A printable performance report for any period: headline figures, best and worst
            strategy, most frequent mistake, best and worst trade, and your risk profile. Every
            number computed by the app from your own trades. No API key needed.
          </p>
          <Link href="/#pricing" className="text-sm text-primary hover:underline">
            See plans
          </Link>
        </Card>
      </div>
    );
  }

  const preset: ReportPreset = isPreset(params.preset) ? params.preset : "last_month";
  const period = resolveReportPeriod(
    preset,
    settings.timezone,
    params.from && params.to ? { startDate: params.from, endDate: params.to } : undefined,
  );

  // Degrades rather than breaking: the report reads several hand-applied
  // migrations, and a pending one must not take the page down.
  const report = period
    ? await buildTradingReport(supabase, period, settings.timezone).catch(() => null)
    : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6 sm:p-8 print:max-w-none print:p-0">
      <div className="print:hidden">
        <h1
            data-tour-id="tour-reports"
            className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
          Reports
        </h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Every figure is computed by the app from your closed trades. Nothing here is written
          by a model.
        </p>
      </div>

      {/* useSearchParams needs a Suspense boundary in a server-rendered page. */}
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <ReportView report={report} preset={preset} />
      </Suspense>
    </div>
  );
}
