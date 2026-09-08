import Link from "next/link";
import { TrendingDown } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { MIN_EPISODES_TO_COMPARE, type DrawdownEpisode, type DrawdownReport } from "@/lib/drawdown/episodes";

// Drawdown as episodes: how often, how deep, how long back.
//
// The figure a trader most needs and is least likely to notice is whether the
// one they are IN is unusual, so that is the first thing on the panel -- and
// it is only claimed once enough episodes have completed to make "deepest
// ever" mean something.

function money(value: number | null): string {
  if (value === null) return "—";
  return `${value < 0 ? "−" : ""}$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function days(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(0)} day${Math.round(value) === 1 ? "" : "s"}`;
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

function EpisodeRow({ episode }: { episode: DrawdownEpisode }) {
  return (
    <tr className="border-t border-zinc-100 dark:border-subtle">
      <td className="py-1.5 text-zinc-600 dark:text-zinc-400">
        {episode.startDate}
        {!episode.recovered && (
          <span className="ml-2 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-500">
            ongoing
          </span>
        )}
      </td>
      <td className="py-1.5 text-right font-mono text-loss">{money(episode.depth)}</td>
      <td className="py-1.5 text-right font-mono text-zinc-600 dark:text-zinc-400">
        {episode.depthPercent === null ? "—" : `${(episode.depthPercent * 100).toFixed(1)}%`}
      </td>
      <td className="py-1.5 text-right font-mono text-zinc-600 dark:text-zinc-400">
        {days(episode.days)}
      </td>
      <td className="py-1.5 text-right font-mono text-zinc-600 dark:text-zinc-400">
        {/* Null while open: the climb has not finished, and a number would
            read as though it had. */}
        {episode.tradesToRecover === null ? "still going" : episode.tradesToRecover}
      </td>
    </tr>
  );
}

export function DrawdownPanel({ report }: { report: DrawdownReport }) {
  if (report.episodes.length === 0) {
    return (
      <Card hoverable={false} className="flex flex-col gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          <TrendingDown className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
          Drawdown &amp; recovery
        </h2>
        <p className="text-sm text-zinc-500">
          Your trading curve has never fallen below a previous peak, so there is nothing to
          report yet.
        </p>
      </Card>
    );
  }

  // Deepest first, so the worst episodes are the ones on screen.
  const shown = [...report.episodes].sort((a, b) => a.depth - b.depth).slice(0, 8);

  return (
    <Card hoverable={false} className="flex flex-col gap-3">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          <TrendingDown className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
          Drawdown &amp; recovery
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Every time your trading fell below a previous peak, how deep it went and how long it
          took to climb back.
        </p>
      </div>

      {report.current && (
        <div
          className={`rounded-lg border px-3 py-2.5 ${
            report.currentIsDeepest
              ? "border-loss/40 bg-loss/5"
              : "border-amber-500/40 bg-amber-500/10"
          }`}
        >
          <p className="text-sm text-zinc-800 dark:text-zinc-200">
            You are currently <strong>{money(report.current.depth)}</strong> below your peak
            {report.current.depthPercent !== null && (
              <> ({(report.current.depthPercent * 100).toFixed(1)}% of the account then)</>
            )}
            , {days(report.current.days)} in.
          </p>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            {report.currentIsDeepest && report.comparable ? (
              <>
                This is the deepest drawdown in your journal. Deeper than all{" "}
                {report.completed.length} that have finished.
              </>
            ) : report.comparable ? (
              <>
                Your completed drawdowns have typically been {money(report.medianDepth)} and taken{" "}
                {days(report.medianDays)} to recover.
              </>
            ) : (
              // Refused rather than asserted: "deepest ever" out of two
              // episodes is true and tells the trader nothing.
              <>
                Too few finished drawdowns ({report.completed.length}) to say whether this one is
                unusual. That needs at least {MIN_EPISODES_TO_COMPARE}.
              </>
            )}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Deepest"
          value={money(report.deepest?.depth ?? null)}
          sub={report.deepest?.recovered ? "recovered" : "ongoing"}
        />
        <Stat label="Typical depth" value={money(report.medianDepth)} sub="median, finished only" />
        <Stat label="Typical recovery" value={days(report.medianDays)} sub="median, finished only" />
        <Stat
          label="Trades to recover"
          value={report.medianTradesToRecover === null ? "—" : String(report.medianTradesToRecover)}
          sub="median, from the trough"
        />
      </div>

      <div className="overflow-x-auto border-t border-zinc-200 pt-3 dark:border-subtle">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
          Deepest episodes
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-zinc-400">
              <th className="py-1 text-left font-medium">Started</th>
              <th className="py-1 text-right font-medium">Depth</th>
              <th className="py-1 text-right font-medium">% of account</th>
              <th className="py-1 text-right font-medium">Duration</th>
              <th className="py-1 text-right font-medium">Trades back</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((episode) => (
              <EpisodeRow key={`${episode.startDate}-${episode.depth}`} episode={episode} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-subtle">
        <p>
          {report.completed.length} finished drawdown
          {report.completed.length === 1 ? "" : "s"}
          {report.current && " plus the one in progress"}. Averages cover finished episodes only.
          An unrecovered drawdown has no recovery time, and including it would drag every figure
          toward today.
        </p>
        <p className="mt-1.5">
          Measured on your trading line, so paying yourself never registers as a drawdown and a
          deposit never ends one. How you traded during these periods is in the risk section
          above; a difference there is a pattern, not proof that drawdowns cause it.
        </p>
      </div>
    </Card>
  );
}

/** What free users see in place of the panel. */
export function DrawdownUpsell() {
  return (
    <Card hoverable={false} className="flex flex-col gap-2">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
        <TrendingDown className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
        Drawdown &amp; recovery
      </h2>
      <p className="text-sm text-zinc-500">
        Every drawdown you have had, how deep, how long, how many trades it took to climb back,
        and whether the one you are in now is normal for you. Available on the paid plan.
      </p>
      <Link href="/#pricing" className="text-sm text-primary hover:underline">
        See plans
      </Link>
    </Card>
  );
}
