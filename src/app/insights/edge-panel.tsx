import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { MIN_SEGMENT_TRADES, type Segment } from "@/lib/segments/engine";
import type { EdgeRow } from "@/lib/edge/queries";

// Find My Edge -- the paid section of /insights.
//
// Everything above it on the page stays free and unchanged. This is an
// additional, deeper view, not a paywall dropped over something that worked
// yesterday.

/** How many to show at each end. Enough to act on, few enough that the list
 *  is a conclusion rather than a data dump. */
const SHOWN_PER_SIDE = 3;

function formatR(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;
}

function SegmentRow({
  segment,
  tone,
}: {
  segment: Segment<EdgeRow>;
  tone: "edge" | "leak";
}) {
  const { stats } = segment;
  const border = tone === "edge" ? "border-profit/30 bg-profit/5" : "border-loss/30 bg-loss/5";

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${border}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            {segment.value}
          </span>
          <span className="ml-2 text-xs text-zinc-500">{segment.dimensionLabel}</span>
        </div>
        <span
          className={`font-mono text-sm tabular-nums ${
            tone === "edge" ? "text-profit" : "text-loss"
          }`}
        >
          {formatR(stats.expectancy)}
        </span>
      </div>

      {/* Every figure the conclusion rests on, so it can be checked. */}
      <p className="mt-1 font-mono text-xs text-zinc-500">
        {stats.trades} trades · {stats.winRate === null ? "—" : `${(stats.winRate * 100).toFixed(0)}%`} win
        rate · {formatR(stats.totalR)} total · expectancy over {stats.withR}
      </p>

      {segment.drillDownUrl ? (
        <Link href={segment.drillDownUrl} className="mt-1 inline-block text-xs text-primary hover:underline">
          View these trades →
        </Link>
      ) : (
        // Honest about why: this segment is computed from timestamps, so no
        // server-side filter reproduces it exactly.
        <span className="mt-1 inline-block text-xs text-zinc-400 dark:text-zinc-600">
          No filter for this dimension yet
        </span>
      )}
    </div>
  );
}

export function EdgePanel({
  edges,
  leaks,
  overallExpectancy,
  tradesAnalysed,
  excludedForSample,
}: {
  edges: Segment<EdgeRow>[];
  leaks: Segment<EdgeRow>[];
  overallExpectancy: number | null;
  tradesAnalysed: number;
  excludedForSample: number;
}) {
  const topEdges = edges.slice(0, SHOWN_PER_SIDE);
  // Guard against a short list double-counting: with four eligible segments,
  // the "worst 3" and "best 3" would otherwise overlap and the same segment
  // would appear as both an edge and a leak.
  const shownEdgeValues = new Set(topEdges.map((s) => `${s.dimensionId}:${s.value}`));
  const topLeaks = leaks
    .filter((s) => !shownEdgeValues.has(`${s.dimensionId}:${s.value}`))
    .slice(0, SHOWN_PER_SIDE);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Find My Edge
        </h2>
        {/* At zero the original read "cutting your 0 closed trades ... your
            overall average is — per trade": a count that reads as broken and a
            dash where a number should be. Both are dropped rather than
            rendered empty. */}
        <p className="mt-0.5 text-sm text-zinc-500">
          {tradesAnalysed === 0 ? (
            <>
              Every way of cutting your closed trades, ranked by expectancy, not by win rate,
              because a setup that wins often for very little is worse than one that wins rarely
              for a lot. Close some trades and this ranks them for you.
            </>
          ) : (
            <>
              Every way of cutting your {tradesAnalysed} closed trade
              {tradesAnalysed === 1 ? "" : "s"}, ranked by expectancy, not by win rate, because a
              setup that wins often for very little is worse than one that wins rarely for a lot.
              {overallExpectancy !== null && (
                <> Your overall average is {formatR(overallExpectancy)} per trade.</>
              )}
            </>
          )}
        </p>
      </div>

      {topEdges.length === 0 ? (
        <Card hoverable={false} className="text-sm text-zinc-500">
          No segment has enough trades yet to rank. Each one needs at least {MIN_SEGMENT_TRADES}{" "}
          trades with an R multiple recorded. A handful of trades is a coincidence, not an edge.
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card hoverable={false} className="flex flex-col gap-2">
            <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
              <TrendingUp className="h-3.5 w-3.5 text-profit" strokeWidth={2} />
              Your strongest edges
            </h3>
            {topEdges.map((segment) => (
              <SegmentRow key={`${segment.dimensionId}:${segment.value}`} segment={segment} tone="edge" />
            ))}
          </Card>

          <Card hoverable={false} className="flex flex-col gap-2">
            <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
              <TrendingDown className="h-3.5 w-3.5 text-loss" strokeWidth={2} />
              Your biggest leaks
            </h3>
            {topLeaks.length === 0 ? (
              <p className="text-sm text-zinc-500">
                Not enough distinct segments to name a leak separately from an edge yet.
              </p>
            ) : (
              topLeaks.map((segment) => (
                <SegmentRow key={`${segment.dimensionId}:${segment.value}`} segment={segment} tone="leak" />
              ))
            )}
          </Card>
        </div>
      )}

      {excludedForSample > 0 && (
        <p className="text-xs text-zinc-500">
          {excludedForSample} segment{excludedForSample === 1 ? "" : "s"} left out for having too
          few trades to rank. They aren&apos;t weak edges. They aren&apos;t yet measurable either
          way.
        </p>
      )}
    </div>
  );
}

/** What free users see in place of the panel. */
export function EdgeUpsell() {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Find My Edge
        </h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          Every way of cutting your trades. Strategy, direction, instrument, day, holding period,
          risk band, emotion, exit behaviour. Ranked by expectancy, with the trades behind each
          one a click away.
        </p>
      </div>
      <Card hoverable={false} className="flex flex-col gap-2">
        <p className="text-sm text-zinc-500">
          Available on the paid plan. Needs no API key. It&apos;s computed from your own trades.
        </p>
        <Link href="/#pricing" className="text-sm text-primary hover:underline">
          See plans
        </Link>
      </Card>
    </div>
  );
}
