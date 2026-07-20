import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listFieldDefinitions } from "@/lib/fields/definitions";
import { getStrategyBreakdown, listStrategies } from "@/lib/strategies/queries";
import { listTradesPage } from "@/lib/trades/queries";
import type { Trade } from "@/lib/trades/types";
import { Card } from "@/components/ui/Card";
import { FieldManager } from "@/app/fields/field-manager";
import { StrategyManager } from "./strategy-manager";

export default async function StrategiesPage({
  searchParams,
}: {
  searchParams: Promise<{ strategy?: string }>;
}) {
  const { strategy: activeStrategyId } = await searchParams;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/sign-in");

  const [breakdown, strategies] = await Promise.all([
    getStrategyBreakdown(supabase),
    listStrategies(supabase),
  ]);

  const activeStrategy = activeStrategyId ? strategies.find((s) => s.id === activeStrategyId) : undefined;

  const [strategyTrades, strategyFields] = activeStrategy
    ? await Promise.all([
        listTradesPage(supabase, { strategyId: activeStrategy.id, pageSize: 50 }),
        listFieldDefinitions(supabase, "trade", activeStrategy.id),
      ])
    : [null, []];

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-6 sm:p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Strategies</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Mark which strategy each trade used to see which ones actually work.
        </p>
      </div>

      <Card hoverable={false}>
        <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
          Win rate by strategy
        </h2>
        {breakdown.length === 0 ? (
          <p className="text-sm text-zinc-500">No strategies yet — add one below to get started.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                <th className="py-1.5 text-left font-medium">Strategy</th>
                <th className="py-1.5 text-right font-medium">Trades</th>
                <th className="py-1.5 text-right font-medium">Win rate</th>
                <th className="py-1.5 text-right font-medium">Total P/L</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((row) => (
                <tr key={row.strategy.id} className="border-t border-zinc-100 dark:border-subtle">
                  <td className="py-2">
                    <Link
                      href={`/strategies?strategy=${row.strategy.id}`}
                      className="flex items-center gap-2 text-zinc-900 hover:text-primary dark:text-zinc-100"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: row.strategy.color ?? "#a1a1aa" }}
                      />
                      {row.strategy.name}
                    </Link>
                  </td>
                  <td className="tnum py-2 text-right font-mono text-zinc-600 dark:text-zinc-400">{row.trades}</td>
                  <td className="tnum py-2 text-right font-mono text-zinc-600 dark:text-zinc-400">
                    {row.winRate === null ? "—" : `${(row.winRate * 100).toFixed(0)}%`}
                  </td>
                  <td className={`tnum py-2 text-right font-mono ${row.totalPL >= 0 ? "text-profit" : "text-loss"}`}>
                    {row.totalPL < 0 ? "−" : "+"}${Math.abs(row.totalPL).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="flex flex-wrap gap-2">
        <TabLink href="/strategies" label="Manage Strategies" active={!activeStrategy} />
        {strategies.map((strategy) => (
          <TabLink
            key={strategy.id}
            href={`/strategies?strategy=${strategy.id}`}
            label={strategy.name}
            active={activeStrategy?.id === strategy.id}
          />
        ))}
      </div>

      {activeStrategy ? (
        <>
          <Card hoverable={false}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
                Trades using {activeStrategy.name}
              </h2>
              <Link
                href={`/trades?strategy=${activeStrategy.id}`}
                className="text-xs text-primary hover:underline"
              >
                View in Trades →
              </Link>
            </div>
            <StrategyTradeList trades={strategyTrades?.trades ?? []} />
          </Card>

          <div>
            <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Custom fields for {activeStrategy.name}
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              These fields only show up on the trade form for trades tagged with this strategy.
            </p>
            <div className="mt-4 max-w-lg">
              <FieldManager entityType="trade" strategyId={activeStrategy.id} initialFields={strategyFields} />
            </div>
          </div>
        </>
      ) : (
        <div className="max-w-lg">
          <StrategyManager initialStrategies={strategies} />
        </div>
      )}
    </div>
  );
}

function TabLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-500"
      }`}
    >
      {label}
    </Link>
  );
}

function StrategyTradeList({ trades }: { trades: Trade[] }) {
  if (trades.length === 0) {
    return <p className="text-sm text-zinc-500">No trades tagged with this strategy yet.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-subtle">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-zinc-200 dark:border-subtle text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-4 py-2">Ticker</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Entry Date</th>
            <th className="px-4 py-2">Dollar P/L</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => (
            <tr key={trade.id} className="border-b border-zinc-100 dark:border-zinc-800/60 last:border-0">
              <td className="px-4 py-2">
                <Link
                  href={`/trades/${trade.id}`}
                  className="font-mono font-semibold uppercase text-zinc-900 dark:text-zinc-100 hover:text-primary"
                >
                  {trade.ticker || "Untitled"}
                </Link>
              </td>
              <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400 capitalize">{trade.status}</td>
              <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">
                {trade.entry_date ? new Date(trade.entry_date).toLocaleDateString() : "—"}
              </td>
              <td className="px-4 py-2">
                {trade.dollar_pl !== null ? (
                  <span className={trade.dollar_pl >= 0 ? "text-profit" : "text-loss"}>
                    ${trade.dollar_pl.toFixed(2)}
                  </span>
                ) : (
                  <span className="text-zinc-400 dark:text-zinc-600">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
