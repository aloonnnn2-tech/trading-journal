import Link from "next/link";
import { Waves } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { MIN_SEGMENT_TRADES } from "@/lib/segments/engine";
import { VOL_WINDOW, type RegimeReport } from "@/lib/regime/queries";

// Performance split by the market volatility each trade closed in.
//
// **Volatility only, deliberately.** The trend axis (bull / bear / sideways
// from the benchmark's own 200-day average) is computable and was measured
// against this journal before being left out: it put every matched trade in
// "Bull", because the period contains no downturn. A one-row breakdown implies
// a comparison the data cannot make.

function pct(value: number | null): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(0)}%`;
}

function r(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;
}

export function RegimePanel({ report }: { report: RegimeReport }) {
  if (!report.available) {
    return (
      <Card hoverable={false} className="flex flex-col gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          <Waves className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
          Market conditions
        </h2>
        {/* Said plainly rather than rendering an empty table, which would read
            as "you have no trades" instead of "we couldn't fetch the data". */}
        <p className="text-sm text-zinc-500">
          Couldn&apos;t fetch {report.benchmark} price history just now, so trades can&apos;t be
          matched to market conditions. Nothing is wrong with your journal. Try again later.
        </p>
      </Card>
    );
  }

  const usable = report.segments.filter((s) => s.stats.trades >= MIN_SEGMENT_TRADES);

  return (
    <Card hoverable={false} className="flex flex-col gap-3">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          <Waves className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
          Market conditions
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Your trades split by how volatile the market was when you closed them, measured on{" "}
          {report.benchmark}.
        </p>
      </div>

      {usable.length < 2 ? (
        <p className="text-sm text-zinc-500">
          Not enough trades in each condition to compare yet, each side needs at least{" "}
          {MIN_SEGMENT_TRADES}.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-zinc-400">
                <th className="py-1 text-left font-medium">Condition</th>
                <th className="py-1 text-right font-medium">Trades</th>
                <th className="py-1 text-right font-medium">Win rate</th>
                <th className="py-1 text-right font-medium">Expectancy</th>
                <th className="py-1 text-right font-medium">Total R</th>
              </tr>
            </thead>
            <tbody>
              {usable.map((segment) => (
                <tr key={segment.value} className="border-t border-zinc-100 dark:border-subtle">
                  <td className="py-1.5">{segment.value}</td>
                  <td className="py-1.5 text-right font-mono text-zinc-500">
                    {segment.stats.trades}
                  </td>
                  <td className="py-1.5 text-right font-mono">{pct(segment.stats.winRate)}</td>
                  <td className="py-1.5 text-right font-mono">
                    {r(segment.stats.expectancy)}
                    {/* The expectancy rests on R-bearing trades alone, which
                        can be fewer than the trade count beside it. */}
                    <span className="ml-1 text-[11px] text-zinc-400">/{segment.stats.withR}</span>
                  </td>
                  <td className="py-1.5 text-right font-mono">{r(segment.stats.totalR)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-subtle">
        <p>
          &quot;High volatility&quot; means the {VOL_WINDOW}-day realised volatility of{" "}
          {report.benchmark} was above its own median for the last decade (
          {(report.medianVolatility * 100).toFixed(1)}% annualised) on the day you closed. It is
          relative to this benchmark&apos;s own history, not an absolute threshold.
        </p>
        {report.excludedByAsset > 0 && (
          <p className="mt-1.5">
            {report.excludedByAsset} crypto or forex trade
            {report.excludedByAsset === 1 ? "" : "s"} excluded. An equity benchmark doesn&apos;t
            describe those markets, and filing them here would be a category error rather than an
            approximation.
          </p>
        )}
        {report.unmatched > 0 && (
          <p className="mt-1.5">
            {report.unmatched} trade{report.unmatched === 1 ? "" : "s"} couldn&apos;t be matched to
            a trading session and {report.unmatched === 1 ? "is" : "are"} left out.
          </p>
        )}
        <p className="mt-1.5">
          Only volatility is shown. Trend (bull / bear / sideways) is measurable, but every trade
          in your journal so far closed in the same one, so it would be a table with a single row.
        </p>
      </div>
    </Card>
  );
}

/** What free users see in place of the panel. */
export function RegimeUpsell() {
  return (
    <Card hoverable={false} className="flex flex-col gap-2">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
        <Waves className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
        Market conditions
      </h2>
      <p className="text-sm text-zinc-500">
        See whether you trade better in calm or volatile markets, measured against the S&amp;P and
        matched to the day you closed each trade. Available on the paid plan.
      </p>
      <Link href="/#pricing" className="text-sm text-primary hover:underline">
        See plans
      </Link>
    </Card>
  );
}
