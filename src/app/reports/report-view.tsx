"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Printer } from "lucide-react";
import { PRESET_LABELS, REPORT_PRESETS, type ReportPreset, type TradingReport } from "@/lib/report/build";
import { formatDateTime } from "@/lib/dates/format";

// The report document, and the controls for choosing what it covers.
//
// **Printing is the browser's own.** `@media print` rules (via Tailwind's
// `print:` variants) hide the controls and chrome, and the browser's Save as
// PDF produces the file. A PDF library would mean a large dependency and a
// server rendering path to produce something that typically looks worse than
// well-marked-up HTML printed by the browser.

function money(value: number | null): string {
  if (value === null) return "—";
  return `${value < 0 ? "−" : ""}$${Math.abs(value).toFixed(2)}`;
}

function r(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;
}

function pct(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function Headline({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-0.5 font-mono text-lg text-zinc-900 dark:text-zinc-100 print:text-black">
        {value}
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  detail,
  href,
}: {
  label: string;
  value: string;
  detail?: string;
  href?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-zinc-200 py-2 dark:border-subtle print:border-zinc-300">
      <span className="text-sm text-zinc-500">{label}</span>
      <span className="text-sm text-zinc-900 dark:text-zinc-100 print:text-black">
        {href ? (
          <Link href={href} className="text-primary hover:underline print:text-black">
            {value}
          </Link>
        ) : (
          value
        )}
        {/* A real space, not just the margin. `ml-2` separates the two
            visually but leaves no word boundary in the text, so the value and
            its detail ran together as "0 tradesmore than 3x your median" for a
            screen reader and for anyone copying the report out of the page --
            which is a thing this report is explicitly meant to support. */}
        {detail && (
          <>
            {" "}
            <span className="ml-2 font-mono text-xs text-zinc-500">{detail}</span>
          </>
        )}
      </span>
    </div>
  );
}

export function ReportView({
  report,
  preset,
}: {
  report: TradingReport | null;
  preset: ReportPreset;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function choose(next: ReportPreset) {
    const query = new URLSearchParams(params.toString());
    query.set("preset", next);
    router.push(`/reports?${query}`);
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Controls: on screen only. */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {REPORT_PRESETS.filter((p) => p !== "custom").map((p) => (
          <button
            key={p}
            onClick={() => choose(p)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              preset === p
                ? "bg-primary text-white dark:text-zinc-950"
                : "border border-zinc-300 text-zinc-600 hover:border-primary dark:border-zinc-700 dark:text-zinc-400"
            }`}
          >
            {PRESET_LABELS[p]}
          </button>
        ))}
        <button
          onClick={() => window.print()}
          disabled={!report}
          className="ml-auto flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50 dark:text-zinc-950"
        >
          <Printer className="h-3.5 w-3.5" strokeWidth={2} />
          Save as PDF
        </button>
      </div>

      {!report ? (
        <p className="text-sm text-zinc-500">Pick a period to build a report.</p>
      ) : report.tradesAnalysed === 0 ? (
        <p className="text-sm text-zinc-500">
          No closed trades in {report.period.label}. A report of an empty period would be a page
          of dashes.
        </p>
      ) : (
        <article className="flex flex-col gap-5">
          <header>
            <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 print:text-black">
              {report.period.label} Trading Report
            </h2>
            <p className="mt-0.5 text-sm text-zinc-500">
              {report.tradesAnalysed} closed trade{report.tradesAnalysed === 1 ? "" : "s"} ·{" "}
              {report.period.startDate} to {report.period.endDate}
            </p>
          </header>

          <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Headline label="Trades" value={String(report.summary.closedCount)} />
            <Headline label="Net P&L" value={money(report.summary.totalPL)} />
            <Headline label="Win rate" value={pct(report.summary.winRate)} />
            <Headline label="Expectancy" value={r(report.summary.expectancy)} />
            <Headline
              label="Profit factor"
              value={report.summary.profitFactor === null ? "—" : report.summary.profitFactor.toFixed(2)}
            />
            <Headline label="Max drawdown" value={money(report.summary.maxDrawdown)} />
          </section>

          <section>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
              Strategies
            </h3>
            {report.bestStrategy ? (
              <Row
                label="Best strategy"
                value={report.bestStrategy.value}
                detail={`${r(report.bestStrategy.stats.expectancy)} over ${report.bestStrategy.stats.trades} trades`}
                href={report.bestStrategy.drillDownUrl ?? undefined}
              />
            ) : (
              <Row
                label="Best strategy"
                value="Not enough trades in any one strategy to rank"
              />
            )}
            {report.worstStrategy && (
              <Row
                label="Worst strategy"
                value={report.worstStrategy.value}
                detail={`${r(report.worstStrategy.stats.expectancy)} over ${report.worstStrategy.stats.trades} trades`}
                href={report.worstStrategy.drillDownUrl ?? undefined}
              />
            )}
          </section>

          <section>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
              Execution
            </h3>
            <Row
              label="Most frequent mistake"
              value={report.biggestMistake?.label ?? "None recorded this period"}
              detail={report.biggestMistake ? `${report.biggestMistake.trades} trades` : undefined}
            />
            {report.bestTrade && (
              <Row
                label="Best trade"
                value={report.bestTrade.ticker || "—"}
                detail={`${money(report.bestTrade.dollarPL)} · ${r(report.bestTrade.rMultiple)}`}
                href={`/trades/${report.bestTrade.id}`}
              />
            )}
            {report.worstTrade && (
              <Row
                label="Worst trade"
                value={report.worstTrade.ticker || "—"}
                detail={`${money(report.worstTrade.dollarPL)} · ${r(report.worstTrade.rMultiple)}`}
                href={`/trades/${report.worstTrade.id}`}
              />
            )}
            <Row
              label="Average win / loss"
              value={`${money(report.summary.avgWin)} / ${money(report.summary.avgLoss)}`}
            />
            <Row
              label="Longest win / loss streak"
              value={`${report.summary.longestWinStreak} / ${report.summary.longestLossStreak}`}
            />
          </section>

          <section>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
              Risk
            </h3>
            <Row
              label="Median risk per trade"
              value={report.risk.median === null ? "Not recorded" : `${report.risk.median.toFixed(2)}%`}
              detail={report.risk.recorded > 0 ? `over ${report.risk.recorded} trades` : undefined}
            />
            <Row
              label="Largest risk"
              value={report.risk.max === null ? "—" : `${report.risk.max.toFixed(2)}%`}
            />
            <Row
              label="Unusually large for you"
              value={`${report.risk.outliers} trade${report.risk.outliers === 1 ? "" : "s"}`}
              detail="more than 3× your median"
            />
          </section>

          <footer className="border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-subtle print:border-zinc-300">
            {/* Every figure traces to a calculation elsewhere in the app --
                the point of this report existing separately from the AI one. */}
            Generated {formatDateTime(report.generatedAt)} from your own closed trades.
            Every figure is computed by the app from stored data; nothing here is estimated or
            written by a model. Investment-mode positions are excluded, as they are everywhere
            else, because they carry no realised P&amp;L.
          </footer>
        </article>
      )}
    </div>
  );
}
