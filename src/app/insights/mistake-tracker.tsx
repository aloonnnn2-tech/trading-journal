import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { MIN_COMPARISON_SAMPLE, type MistakeSource, type MistakeSummary } from "@/lib/mistakes/analyze";

// The mistake tracker section of /insights.
//
// Server-rendered and non-interactive: every figure is a pure function of the
// journal, so there is nothing to fetch on the client.
//
// The comparison is presented as **two cohorts side by side**, never as a cost
// attributed to the mistake. "Trades where this happened averaged -0.08R
// against +0.51R elsewhere" is what the data supports; "moving your stop costs
// you 0.59R per trade" is a causal claim it does not -- a trader moves stops on
// trades already going against them, so the mistake and the loss share a cause.

const SOURCE_LABELS: Record<MistakeSource, string> = {
  detected: "detected",
  rule: "broken rule",
  tagged: "you tagged it",
};

function formatR(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;
}

function MistakeRow({ summary }: { summary: MistakeSummary }) {
  const { withMistake, withoutMistake, expectancyGap } = summary;

  return (
    <div className="border-t border-zinc-200 py-3 first:border-t-0 first:pt-0 dark:border-subtle">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            {summary.label}
          </span>
          {summary.sources.map((source) => (
            <span
              key={source}
              className="rounded-full border border-zinc-300 px-2 py-0.5 text-[10px] uppercase tracking-wider text-zinc-500 dark:border-zinc-700"
            >
              {SOURCE_LABELS[source]}
            </span>
          ))}
        </div>
        <span className="font-mono text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
          {withMistake.trades} trade{withMistake.trades === 1 ? "" : "s"}
        </span>
      </div>

      {expectancyGap === null ? (
        // Withheld, and said so. A gap computed from four trades looks exactly
        // as authoritative as one from four hundred unless the absence is
        // explained.
        <p className="mt-1.5 text-xs text-zinc-500">
          Not enough trades on both sides to compare performance yet. Needs at least{" "}
          {MIN_COMPARISON_SAMPLE} with an R multiple in each group.
        </p>
      ) : (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-loss/30 bg-loss/5 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wider text-zinc-500">With this mistake</p>
            <p className="mt-0.5 font-mono text-sm text-zinc-800 dark:text-zinc-200">
              {formatR(withMistake.expectancy)}
              <span className="ml-2 text-xs text-zinc-500">
                over {withMistake.withR} trade{withMistake.withR === 1 ? "" : "s"}
              </span>
            </p>
          </div>
          <div className="rounded-lg border border-profit/30 bg-profit/5 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wider text-zinc-500">
              Every other trade
            </p>
            <p className="mt-0.5 font-mono text-sm text-zinc-800 dark:text-zinc-200">
              {formatR(withoutMistake.expectancy)}
              <span className="ml-2 text-xs text-zinc-500">
                over {withoutMistake.withR} trades
              </span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function MistakeTracker({
  summaries,
  tradesAnalysed,
  nothingTagged,
}: {
  summaries: MistakeSummary[];
  tradesAnalysed: number;
  nothingTagged: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Mistakes
        </h2>
        {/* The count is dropped at zero: "across your 0 closed trades" is
            the sentence every new account was shown. */}
        <p className="mt-0.5 text-sm text-zinc-500">
          {tradesAnalysed === 0 ? (
            <>
              Recurring errors across your closed trades. Detected from your own data, taken from
              broken plan rules, and tagged by you on the trade form. Nothing to show until you
              have closed a few.
            </>
          ) : (
            <>
              Recurring errors across your {tradesAnalysed} closed trade
              {tradesAnalysed === 1 ? "" : "s"}. Detected from your own data, taken from broken
              plan rules, and tagged by you on the trade form.
            </>
          )}
        </p>
      </div>

      {summaries.length === 0 ? (
        <Card hoverable={false} className="text-sm text-zinc-500">
          No mistakes found yet. This fills in as you tag them on a trade, define plan rules on
          the{" "}
          <Link href="/strategies" className="text-primary hover:underline">
            Strategies page
          </Link>
          , or log enough trades for moved stops and oversized positions to be detectable.
        </Card>
      ) : (
        <Card hoverable={false} className="flex flex-col">
          {summaries.map((summary) => (
            <MistakeRow key={summary.label} summary={summary} />
          ))}

          <p className="mt-3 border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-subtle">
            These are two groups of trades compared side by side, not a cost attributed to the
            mistake. A stop often gets moved on a trade that was already going against you, so
            the mistake and the loss can share a cause.
            {nothingTagged && (
              <>
                {" "}
                Nothing has been tagged by hand yet: the <strong>Mistakes</strong> field on the
                trade form captures the ones only you know about.
              </>
            )}
          </p>
        </Card>
      )}
    </div>
  );
}
