import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { missingExitDateMessage, type ClosedMissingExitDate } from "@/lib/trades/missing-exit-date";

/**
 * Shown on the dashboard and Analytics when a closed trade has no exit date:
 * it is counted as closed but left out of every dated stat, and without this
 * the two numbers simply disagree. Renders nothing when there is none.
 */
export function MissingExitDateNotice({ missing }: { missing: ClosedMissingExitDate }) {
  const message = missingExitDateMessage(missing);
  if (!message || !missing.firstTradeId) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" strokeWidth={2} />
      <span className="min-w-0 flex-1">{message}</span>
      <Link
        href={`/trades/${missing.firstTradeId}`}
        className="font-medium text-primary underline-offset-2 hover:underline"
      >
        {missing.count === 1 ? "Add the exit date" : "Start with the newest"}
      </Link>
    </div>
  );
}
