import type { Trade } from "@/lib/trades/types";

// Shared by the trade list and its side panel.
export function ResultBadge({ result, status }: { result: Trade["result"]; status: Trade["status"] }) {
  const colors: Record<Trade["result"], string> = {
    open: "bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200",
    win: "bg-profit/15 text-profit dark:bg-profit/15",
    loss: "bg-loss/15 text-loss dark:bg-loss/15",
    break_even: "bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300",
  };
  // A resting order has no result yet. Its row stores "open" (the enum's
  // neutral value) but showing that reads as a live position; the badge
  // follows the status instead.
  const label = status === "pending" ? "pending" : result;
  return <span className={`rounded-full px-2 py-0.5 text-xs ${colors[result]}`}>{label}</span>;
}
