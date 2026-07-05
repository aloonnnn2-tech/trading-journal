import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAnalyticsSummary } from "@/lib/analytics/queries";
import { EquityDrawdownChart } from "./equity-drawdown-chart";
import { RMultipleHistogram } from "./r-multiple-histogram";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { StaggerGrid } from "@/components/motion/StaggerGrid";
import { InfoTip } from "@/components/ui/InfoTip";

function money(n: number): string {
  return `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;
}

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/sign-in");

  const summary = await getAnalyticsSummary(supabase);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-6 sm:p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Analytics</h1>
        <p className="mt-0.5 text-sm text-zinc-500">Every stat below is computed from your closed trades.</p>
      </div>

      <StaggerGrid className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <StatCard
          label="Total P/L"
          value={money(summary.totalPL)}
          tone={summary.totalPL > 0 ? "positive" : summary.totalPL < 0 ? "negative" : "neutral"}
          colorValue
        />
        <StatCard
          label="Win rate"
          value={summary.winRate === null ? "—" : `${(summary.winRate * 100).toFixed(0)}%`}
          meter={summary.winRate ?? undefined}
        />
        <StatCard
          label="Profit factor"
          tooltip="How much you make for every $1 you lose. Above 1 means you're profitable overall."
          value={summary.profitFactor === null ? "—" : summary.profitFactor.toFixed(2)}
        />
        <StatCard
          label="Avg return per trade"
          tooltip="Your average result per trade, measured in multiples of how much you risked (called 'R'). 0.5 means you typically gain half your risk amount per trade."
          value={summary.expectancy === null ? "—" : `${summary.expectancy.toFixed(2)}R`}
          tone={summary.expectancy === null ? "neutral" : summary.expectancy > 0 ? "positive" : "negative"}
        />
        <StatCard label="Avg win" value={summary.avgWin === null ? "—" : money(summary.avgWin)} />
        <StatCard label="Avg loss" value={summary.avgLoss === null ? "—" : money(summary.avgLoss)} />
        <StatCard label="Longest win streak" value={String(summary.longestWinStreak)} />
        <StatCard label="Longest loss streak" value={String(summary.longestLossStreak)} />
        <StatCard
          label="Current streak"
          tooltip="How many wins or losses you've had in a row, most recent first."
          value={
            summary.currentStreak.type === null
              ? "—"
              : `${summary.currentStreak.count} ${summary.currentStreak.type === "loss" ? "loss" : "win"}${summary.currentStreak.count > 1 ? (summary.currentStreak.type === "loss" ? "es" : "s") : ""}`
          }
          tone={summary.currentStreak.type === "win" ? "positive" : summary.currentStreak.type === "loss" ? "negative" : "neutral"}
        />
        <StatCard
          label="Best month"
          value={summary.bestMonth === null ? "—" : summary.bestMonth.month}
          hint={summary.bestMonth === null ? undefined : money(summary.bestMonth.totalPL)}
        />
        <StatCard
          label="Worst month"
          value={summary.worstMonth === null ? "—" : summary.worstMonth.month}
          hint={summary.worstMonth === null ? undefined : money(summary.worstMonth.totalPL)}
        />
        <StatCard
          label="Avg holding time"
          value={summary.avgHoldingDays === null ? "—" : `${summary.avgHoldingDays.toFixed(1)} days`}
        />
        <StatCard
          label="Largest winner"
          value={summary.largestWinner === null ? "—" : money(summary.largestWinner)}
        />
        <StatCard
          label="Largest loser"
          value={summary.largestLoser === null ? "—" : money(summary.largestLoser)}
        />
        <StatCard
          label="Avg position size"
          tooltip="The average dollar amount you put into a single trade."
          value={summary.avgPositionSize === null ? "—" : money(summary.avgPositionSize)}
        />
      </StaggerGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card hoverable={false}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
              Account value over time
              <InfoTip text="The green line shows your account balance growing over time. The red line below shows 'drawdown' — how far you've dropped from your highest point." />
            </h2>
            <span className="text-xs text-zinc-500">
              Max drawdown <span className="tnum font-mono text-loss">{money(summary.maxDrawdown)}</span>
            </span>
          </div>
          <EquityDrawdownChart data={summary.equityCurve} />
        </Card>

        <Card hoverable={false}>
          <h2 className="mb-4 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
            Win/loss size breakdown
            <InfoTip text="Groups your trades by how big the win or loss was, relative to how much you risked. Bars on the right (bigger wins) are better than bars on the left (bigger losses)." />
          </h2>
          <RMultipleHistogram data={summary.rMultiples} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <BreakdownTable
          title="Win rate by direction"
          rows={summary.byDirection.map((row) => ({
            key: row.direction,
            label: row.direction,
            trades: row.trades,
            winRate: row.winRate,
            totalPL: row.totalPL,
          }))}
        />
        <BreakdownTable
          title="Win rate by tag"
          rows={summary.byTag.map((row) => ({
            key: row.tag,
            label: row.tag.replace(/_/g, " "),
            trades: row.trades,
            winRate: row.winRate,
            totalPL: row.totalPL,
          }))}
        />
      </div>
    </div>
  );
}

function BreakdownTable({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; label: string; trades: number; winRate: number | null; totalPL: number }[];
}) {
  return (
    <Card hoverable={false}>
      <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No closed trades yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              <th className="py-1.5 text-left font-medium">Segment</th>
              <th className="py-1.5 text-right font-medium">Trades</th>
              <th className="py-1.5 text-right font-medium">Win rate</th>
              <th className="py-1.5 text-right font-medium">Total P/L</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-zinc-100 dark:border-subtle">
                <td className="py-2 capitalize text-zinc-900 dark:text-zinc-100">{row.label}</td>
                <td className="tnum py-2 text-right font-mono text-zinc-600 dark:text-zinc-400">{row.trades}</td>
                <td className="py-2 pl-4">
                  <span className="flex items-center justify-end gap-2">
                    <span className="hidden h-1 w-14 overflow-hidden rounded-full bg-zinc-200 sm:block dark:bg-zinc-800">
                      <span
                        className="block h-full rounded-full bg-gradient-to-r from-primary to-accent"
                        style={{ width: `${((row.winRate ?? 0) * 100).toFixed(0)}%` }}
                      />
                    </span>
                    <span className="tnum font-mono text-zinc-600 dark:text-zinc-400">
                      {row.winRate === null ? "—" : `${(row.winRate * 100).toFixed(0)}%`}
                    </span>
                  </span>
                </td>
                <td
                  className={`tnum py-2 text-right font-mono ${row.totalPL >= 0 ? "text-profit" : "text-loss"}`}
                >
                  {row.totalPL < 0 ? "−" : "+"}${Math.abs(row.totalPL).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
