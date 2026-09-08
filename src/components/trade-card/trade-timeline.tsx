import { Card } from "@/components/ui/Card";
import type { Replay, ReplayEvent } from "@/lib/replay/build";

// The chronological record of one trade.
//
// A server component: the whole thing is a pure function of rows the page
// already loaded.
//
// **Recorded events are labelled as such.** A change's timestamp is when the
// journal was edited, not when the market moved, and the difference can be
// days. Presenting the two identically would imply a precision this data does
// not have -- which is also why none of this is drawn on the price chart.

const DOT: Record<ReplayEvent["kind"], string> = {
  created: "bg-zinc-400 dark:bg-zinc-600",
  entry: "bg-primary",
  change: "bg-amber-500",
  exit: "bg-profit",
};

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TradeTimeline({ replay }: { replay: Replay }) {
  return (
    <Card standalone={false} className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
        Timeline
      </h2>

      <ol className="flex flex-col">
        {replay.events.map((event, i) => (
          <li key={`${event.kind}-${event.at}-${i}`} className="flex gap-3">
            {/* The rail: a dot per event, with a line joining all but the last. */}
            <div className="flex flex-col items-center">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[event.kind]}`} />
              {i < replay.events.length - 1 && (
                <span className="w-px flex-1 bg-zinc-200 dark:bg-subtle" />
              )}
            </div>

            <div className="flex-1 pb-4">
              <p className="text-sm text-zinc-900 dark:text-zinc-100">
                {event.label}
                {event.from !== undefined && event.to !== undefined && (
                  <span className="ml-2 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                    {event.from} → {event.to}
                  </span>
                )}
              </p>
              <p className="text-[11px] text-zinc-500">
                {when(event.at)}
                {event.recorded && (
                  // The distinction the whole feature rests on.
                  <span className="ml-1.5 text-zinc-400 dark:text-zinc-600">· recorded</span>
                )}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <div className="border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-subtle">
        {replay.snapshots === 0 ? (
          <p>
            This trade hasn&apos;t been edited since it was logged, so there is nothing between
            entry and exit to show. That is a real answer, not missing history.
          </p>
        ) : (
          <p>
            Times marked <strong>recorded</strong> are when the journal was edited, not when the
            market moved. If you moved a stop on Tuesday and wrote it down on Friday, it appears
            on Friday.
          </p>
        )}
        {replay.mayBeTruncated && (
          <p className="mt-1.5 text-amber-600 dark:text-amber-400">
            This trade has enough edits to have reached the history limit, so its earliest changes
            may no longer be stored. The timeline may be incomplete.
          </p>
        )}
        <p className="mt-1.5">
          Partial exits and strategy changes aren&apos;t shown: this app records a single entry
          and exit per trade, and strategy tags aren&apos;t versioned, so neither leaves a record
          to replay.
        </p>
      </div>
    </Card>
  );
}
