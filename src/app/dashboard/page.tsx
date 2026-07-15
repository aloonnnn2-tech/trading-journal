import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getBestWorstSetup,
  getMonthlyPL,
  getPerformanceSeries,
  getRecentNotes,
  getRecentTrades,
  getTodayPL,
  getWinRate,
} from "@/lib/dashboard/queries";
import { getEmotionHistory, type EmotionHistoryEntry } from "@/lib/emotions/queries";
import type { RecentNote, SetupStats } from "@/lib/dashboard/queries";
import { getStatusCounts } from "@/lib/trades/queries";
import { getAccountBalance, listAccountTransactions } from "@/lib/account/queries";
import { getUserSettings } from "@/lib/settings/queries";
import type { Trade } from "@/lib/trades/types";
import { Wallet, Clock, Activity, CheckCircle2, Target } from "lucide-react";
import { PerformanceChart } from "./performance-chart";
import { MonthlyCalendar } from "./monthly-calendar";
import { DashboardGrid } from "./dashboard-grid";
import { AccountCashCard } from "./account-cash-card";
import { StatCard } from "@/components/ui/StatCard";
import { StaggerGrid } from "@/components/motion/StaggerGrid";
import { QuickTradeButton } from "@/app/trades/new-trade-button";
import { TrackPageView } from "@/components/track-page-view";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/sign-in");

  const now = new Date();
  const [
    counts,
    todayPL,
    winRate,
    recentTrades,
    performanceSeries,
    monthlyPL,
    settings,
    bestWorstSetup,
    recentNotes,
    recentEmotions,
    accountBalance,
    accountTransactions,
  ] = await Promise.all([
    getStatusCounts(supabase),
    getTodayPL(supabase),
    getWinRate(supabase),
    getRecentTrades(supabase, 5),
    getPerformanceSeries(supabase, 200),
    getMonthlyPL(supabase, now.getUTCFullYear(), now.getUTCMonth()),
    getUserSettings(supabase, data.user.id),
    getBestWorstSetup(supabase),
    getRecentNotes(supabase, 5),
    getEmotionHistory(supabase, 5),
    getAccountBalance(supabase),
    listAccountTransactions(supabase),
  ]);

  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-6 sm:p-8">
      <TrackPageView event="dashboard_viewed" />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Dashboard
          </h1>
          <p className="mt-0.5 text-sm text-zinc-500">{dateLabel}</p>
        </div>
        <QuickTradeButton />
      </div>

      <StaggerGrid className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <AccountCashCard
          initialBalance={accountBalance}
          initialTransactions={accountTransactions}
        />
        <StatCard
          label="Today's P/L"
          value={`${todayPL < 0 ? "−" : ""}$${Math.abs(todayPL).toFixed(2)}`}
          tone={todayPL > 0 ? "positive" : todayPL < 0 ? "negative" : "neutral"}
          colorValue
          icon={Wallet}
          iconClass={
            todayPL > 0
              ? "bg-profit/10 text-profit"
              : todayPL < 0
                ? "bg-loss/10 text-loss"
                : "bg-primary/10 text-primary"
          }
        />
        <StatCard
          label="Pending orders"
          value={String(counts.pending)}
          icon={Clock}
          iconClass="bg-amber-500/10 text-amber-500"
        />
        <StatCard
          label="Open trades"
          value={String(counts.open)}
          icon={Activity}
          iconClass="bg-primary/10 text-primary"
        />
        <StatCard
          label="Closed trades"
          value={String(counts.closed)}
          icon={CheckCircle2}
          iconClass="bg-accent/10 text-accent"
        />
        <StatCard
          label="Win rate"
          value={winRate.rate === null ? "—" : `${(winRate.rate * 100).toFixed(0)}%`}
          meter={winRate.rate ?? undefined}
          icon={Target}
          iconClass="bg-profit/10 text-profit"
        />
      </StaggerGrid>

      <DashboardGrid
        initialLayout={settings.dashboard_layout}
        widgets={{
          performance: <PerformanceChart data={performanceSeries} />,
          calendar: (
            <MonthlyCalendar year={now.getUTCFullYear()} month={now.getUTCMonth()} dailyPL={monthlyPL} />
          ),
          recent_trades: <RecentTradesList trades={recentTrades} />,
          best_worst_setup: <BestWorstSetup best={bestWorstSetup.best} worst={bestWorstSetup.worst} />,
          recent_notes: <RecentNotesList notes={recentNotes} />,
          recent_emotions: <RecentEmotionsList entries={recentEmotions} />,
        }}
      />
    </div>
  );
}

function RecentTradesList({ trades }: { trades: Trade[] }) {
  if (trades.length === 0) {
    return <p className="text-sm text-zinc-500">No trades yet. Log your first one to get started.</p>;
  }

  return (
    <ul className="flex flex-col">
      {trades.map((trade) => (
        <li key={trade.id} className="border-b border-zinc-100 last:border-0 dark:border-subtle">
          <Link
            href={`/trades/${trade.id}`}
            className="flex items-center justify-between gap-3 rounded-md px-2 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="font-mono text-[13px] font-medium tracking-tight text-zinc-900 dark:text-zinc-100">
                {trade.ticker || "—"}
              </span>
              <span className="rounded-full border border-zinc-200 px-1.5 py-px text-[10px] uppercase tracking-wide text-zinc-500 dark:border-subtle">
                {trade.status}
              </span>
            </span>
            {trade.dollar_pl !== null && (
              <span
                className={`tnum font-mono text-[13px] ${trade.dollar_pl >= 0 ? "text-profit" : "text-loss"}`}
              >
                {trade.dollar_pl < 0 ? "−" : "+"}${Math.abs(trade.dollar_pl).toFixed(2)}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function BestWorstSetup({ best, worst }: { best: SetupStats | null; worst: SetupStats | null }) {
  if (!best) {
    return <p className="text-sm text-zinc-500">No tagged, closed trades yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <SetupRow label="Best setup" stats={best} tone="positive" />
      {worst && <SetupRow label="Worst setup" stats={worst} tone="negative" />}
    </div>
  );
}

function SetupRow({
  label,
  stats,
  tone,
}: {
  label: string;
  stats: SetupStats;
  tone: "positive" | "negative";
}) {
  return (
    <div className="rounded-lg border border-zinc-100 px-3 py-2.5 dark:border-subtle">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">{label}</p>
        <p className={`tnum font-mono text-[13px] ${tone === "positive" ? "text-profit" : "text-loss"}`}>
          {stats.totalPL < 0 ? "−" : "+"}${Math.abs(stats.totalPL).toFixed(2)}
        </p>
      </div>
      <p className="mt-1 text-sm font-medium capitalize text-zinc-900 dark:text-zinc-100">
        {stats.tag.replace(/_/g, " ")}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
            style={{ width: `${((stats.winRate ?? 0) * 100).toFixed(0)}%` }}
          />
        </div>
        <span className="text-xs text-zinc-500">
          {stats.winRate !== null ? `${(stats.winRate * 100).toFixed(0)}% win` : "—"} · {stats.trades} trades
        </span>
      </div>
    </div>
  );
}

function RecentNotesList({ notes }: { notes: RecentNote[] }) {
  if (notes.length === 0) {
    return <p className="text-sm text-zinc-500">No notes logged yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-1">
      {notes.map((note, i) => (
        <li key={`${note.tradeId}-${i}`}>
          <Link href={`/trades/${note.tradeId}`} className="block rounded-md px-2 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">
              <span className="font-mono font-medium text-zinc-600 dark:text-zinc-400">{note.ticker || "—"}</span> · {note.label}
            </p>
            <p className="mt-0.5 line-clamp-2 text-sm text-zinc-700 dark:text-zinc-300">{note.text}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function RecentEmotionsList({ entries }: { entries: EmotionHistoryEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-zinc-500">No emotion entries yet.</p>;
  }

  return (
    <ul className="flex flex-col">
      {entries.map((entry) => (
        <li key={entry.tradeId} className="border-b border-zinc-100 last:border-0 dark:border-subtle">
          <Link
            href={`/trades/${entry.tradeId}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
          >
            <span className="font-mono text-[13px] font-medium text-zinc-900 dark:text-zinc-100">
              {entry.ticker || "—"}
            </span>
            <span className="flex flex-wrap gap-1 text-xs text-zinc-500">
              {entry.before.map((e) => (
                <span key={e} className="rounded-full border border-zinc-200 px-2 py-0.5 dark:border-subtle">
                  {e}
                </span>
              ))}
              {entry.intensity !== null && (
                <span className="tnum rounded-full border border-zinc-200 px-2 py-0.5 font-mono dark:border-subtle">
                  {entry.intensity}/10
                </span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
