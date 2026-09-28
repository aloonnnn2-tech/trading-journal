import Link from "next/link";
import { AddTradeButton } from "./new-trade-button";
import { ScreenshotTradeButton } from "./screenshot-trade-button";

// Shown on the Dashboard and Trades pages while the journal is empty (Phase
// 4D; the spec's banner). "From a file", not the spec's "CSV": the importer
// takes files, but no broker's CSV export is confirmed, and the wording
// shouldn't read as if one were. Each option is the real control, not a link
// to a page that has it.
export function ImportFirstTrade({ accountBalance }: { accountBalance: number | null }) {
  return (
    <section
      aria-labelledby="import-first-trade"
      className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <h2 id="import-first-trade" className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Import your first trade
        </h2>
        <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
          Your journal is empty. Everything in the app fills in from here.
        </p>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <ScreenshotTradeButton accountBalance={accountBalance} label="From a screenshot" />
        <Link
          href="/trades/import"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-200"
        >
          From a file
        </Link>
        <AddTradeButton label="Enter it manually" />
      </div>
    </section>
  );
}
