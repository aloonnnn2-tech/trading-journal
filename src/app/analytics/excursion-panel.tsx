"use client";

import { useState } from "react";
import { FormError } from "@/components/form-error";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity } from "lucide-react";
import { Card } from "@/components/ui/Card";
import type { CaptureBand, ExcursionAverages, ExcursionReport } from "@/lib/excursions/aggregate";

// MAE / MFE aggregates -- the paid section of /analytics.
//
// Every figure here is an OUTER BOUND, because it rests on daily bars that
// include the entry and exit days in full. That is stated on screen rather
// than buried: presenting "average MAE -3.1%" as exact, when the entry day's
// low may predate the entry, would be precisely the kind of number this app
// exists not to produce.

const STATUS_EXPLANATIONS: Record<string, string> = {
  same_day: "opened and closed the same day. One daily bar can't separate the hold from the session",
  no_data: "no price history for that symbol in the period",
  no_prices: "entry or exit price not recorded",
  no_direction: "long or short not recorded",
  coarse_data: "the price provider returned bars coarser than daily, which can't measure a short hold",
};

function pct(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function r(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-0.5 font-mono text-sm text-zinc-900 dark:text-zinc-100">{value}</p>
      {sub && <p className="text-[11px] text-zinc-500">{sub}</p>}
    </div>
  );
}

function AveragesRow({ title, stats }: { title: string; stats: ExcursionAverages }) {
  if (stats.trades === 0) {
    return (
      <div className="border-t border-zinc-200 py-3 dark:border-subtle">
        <p className="text-sm text-zinc-500">
          {title}: no trades with a usable excursion yet.
        </p>
      </div>
    );
  }

  return (
    <div className="border-t border-zinc-200 py-3 dark:border-subtle">
      <p className="mb-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
        {title}
        <span className="ml-2 font-mono text-xs text-zinc-500">{stats.trades} trades</span>
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Avg MAE" value={pct(stats.avgMaePercent)} sub={r(stats.avgMaeR)} />
        <Stat label="Avg MFE" value={pct(stats.avgMfePercent)} sub={r(stats.avgMfeR)} />
        <Stat
          label="Captured"
          value={stats.medianCapture === null ? "—" : `${(stats.medianCapture * 100).toFixed(0)}%`}
          sub={stats.captureSample > 0 ? `median of ${stats.captureSample}` : "no favourable move"}
        />
        {/* Stated because the R averages cover fewer trades than the % ones
            whenever a trade recorded no stop. */}
        <Stat label="With a stop" value={`${stats.withR}/${stats.trades}`} sub="R figures rest on these" />
      </div>
    </div>
  );
}

/**
 * Exit efficiency: how much of the available move was kept.
 *
 * Presented as a COMPARISON, never as a grade. Two things bias the absolute
 * number low and both are stated on screen rather than left for the reader to
 * discover:
 *
 *   1. Nobody sells the exact high, so 100% is unattainable and there is no
 *      absolute figure that counts as good.
 *   2. MFE is measured from daily bars that include the exit day in FULL, so a
 *      spike after the exit inflates the "available" move and deflates the
 *      capture.
 *
 * The bias applies roughly evenly across a trader's own segments, which is why
 * the by-strategy comparison beneath is the part worth acting on.
 */
function ExitEfficiency({ stats }: { stats: ExcursionAverages }) {
  const bands = stats.captureBands.filter((b) => b.trades > 0);
  const maxInBand = Math.max(1, ...bands.map((b) => b.trades));

  if (stats.captureSample === 0) {
    return (
      <div className="border-t border-zinc-200 py-3 dark:border-subtle">
        <p className="text-sm text-zinc-500">
          Exit efficiency: no measured trade moved in your favour yet, so there is nothing to
          have captured.
        </p>
      </div>
    );
  }

  return (
    <div className="border-t border-zinc-200 py-3 dark:border-subtle">
      <p className="mb-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
        Exit efficiency
        <span className="ml-2 font-mono text-xs text-zinc-500">
          {stats.captureSample} trades
        </span>
      </p>

      {/* Available vs kept, both on the same price basis so the pair is
          directly comparable and their ratio is the capture. */}
      <div className="mb-3 grid grid-cols-3 gap-3">
        <Stat label="Move available" value={r(stats.avgMfeR)} sub="average MFE" />
        <Stat label="You kept" value={r(stats.avgRealisedR)} sub={`over ${stats.realisedRSample}`} />
        <Stat
          label="Median capture"
          value={stats.medianCapture === null ? "—" : `${(stats.medianCapture * 100).toFixed(0)}%`}
          sub="of the favourable move"
        />
      </div>

      <div className="flex flex-col gap-1">
        {bands.map((band: CaptureBand) => (
          <div key={band.label} className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-xs text-zinc-500">{band.label}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className={`h-full rounded-full ${
                  band.label === "Gave it back" ? "bg-loss" : "bg-primary"
                }`}
                style={{ width: `${(band.trades / maxInBand) * 100}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
              {band.trades}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-2 text-xs text-zinc-500">
        Capturing 100% would mean selling the exact high, so there is no score to aim at here,
        and because the exit day&apos;s bar is counted whole, a move that happened after you sold
        still counts as &quot;available&quot;, which pushes this number down. Compare it across
        your own strategies below rather than reading it as a grade.
      </p>
    </div>
  );
}

export function ExcursionPanel({ report }: { report: ExcursionReport }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function recompute() {
    setRunning(true);
    setError(null);
    setMessage(null);

    const res = await fetch("/api/excursions", { method: "POST" });
    setRunning(false);

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Couldn't calculate excursions.");
      return;
    }

    const summary = (await res.json()) as {
      computed: number;
      tradesConsidered: number;
      symbolsFailed: string[];
    };
    setMessage(
      `Measured ${summary.computed} of ${summary.tradesConsidered} closed trades` +
        (summary.symbolsFailed.length > 0
          ? `. No price history for ${summary.symbolsFailed.join(", ")}.`
          : "."),
    );
    // The page was rendered before these existed, so its payload is stale.
    router.refresh();
  }

  const hasAny = report.overall.trades > 0;

  return (
    <Card hoverable={false} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            <Activity className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
            MAE / MFE
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            How far each trade went against you after entry, and how far it went in your favour
            before you closed it.
          </p>
        </div>
        <button
          onClick={recompute}
          disabled={running}
          className="shrink-0 rounded-full bg-primary px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50 dark:text-zinc-950"
        >
          {running ? "Measuring..." : hasAny ? "Recalculate" : "Calculate"}
        </button>
      </div>

      {hasAny ? (
        <>
          <AveragesRow title="All measured trades" stats={report.overall} />
          <AveragesRow title="Winners" stats={report.winners} />
          <AveragesRow title="Losers" stats={report.losers} />
          <ExitEfficiency stats={report.overall} />

          {report.byStrategy.length > 0 && (
            <div className="border-t border-zinc-200 pt-3 dark:border-subtle">
              <p className="mb-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                By strategy
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-zinc-400">
                      <th className="py-1 text-left font-medium">Strategy</th>
                      <th className="py-1 text-right font-medium">Trades</th>
                      <th className="py-1 text-right font-medium">Avg MAE</th>
                      <th className="py-1 text-right font-medium">Avg MFE</th>
                      <th className="py-1 text-right font-medium">Captured</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byStrategy.map(({ strategy, stats }) => (
                      <tr key={strategy} className="border-t border-zinc-100 dark:border-subtle">
                        <td className="py-1.5">{strategy}</td>
                        <td className="py-1.5 text-right font-mono text-zinc-500">{stats.trades}</td>
                        <td className="py-1.5 text-right font-mono">{pct(stats.avgMaePercent)}</td>
                        <td className="py-1.5 text-right font-mono">{pct(stats.avgMfePercent)}</td>
                        <td className="py-1.5 text-right font-mono">
                          {stats.medianCapture === null
                            ? "—"
                            : `${(stats.medianCapture * 100).toFixed(0)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-zinc-500">
          Nothing measured yet. Calculating fetches daily price history for each instrument you
          traded and measures how far each position moved while you held it.
        </p>
      )}

      <div className="border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-subtle">
        {report.includesPartialDays && (
          <p>
            These are <strong>outer bounds</strong>, not exact figures: they rest on daily highs
            and lows, and the entry and exit days are counted whole, so part of the movement may
            have happened before you entered or after you exited. The real excursion is no worse
            than shown.
          </p>
        )}
        {Object.keys(report.unavailable).length > 0 && (
          <p className="mt-1.5">
            Not measurable:{" "}
            {Object.entries(report.unavailable)
              .map(([status, count]) => `${count} ${STATUS_EXPLANATIONS[status] ?? status}`)
              .join("; ")}
            .
          </p>
        )}
        {report.notComputed > 0 && (
          <p className="mt-1.5">
            {report.notComputed} closed trade{report.notComputed === 1 ? "" : "s"} not measured yet
           . Press {hasAny ? "Recalculate" : "Calculate"} to include{" "}
            {report.notComputed === 1 ? "it" : "them"}.
          </p>
        )}
        {message && <p className="mt-1.5 text-zinc-600 dark:text-zinc-400">{message}</p>}
        <FormError className="mt-1.5">{error}</FormError>
      </div>
    </Card>
  );
}

/** What free users see in place of the panel. */
export function ExcursionUpsell() {
  return (
    <Card hoverable={false} className="flex flex-col gap-2">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
        <Activity className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
        MAE / MFE
      </h2>
      <p className="text-sm text-zinc-500">
        Measure how far each trade moved against you after entry, and how much of the favourable
        move you actually captured. The honest test of where your stops sit and whether you exit
        too early. Available on the paid plan.
      </p>
      <Link href="/#pricing" className="text-sm text-primary hover:underline">
        See plans
      </Link>
    </Card>
  );
}
