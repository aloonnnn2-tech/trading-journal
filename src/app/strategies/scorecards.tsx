import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { MIN_SEGMENT_TRADES, type SegmentStats } from "@/lib/segments/engine";
import type { ScorecardReport, StrategyScorecard } from "@/lib/scorecards/queries";

// Detailed strategy scorecards -- the paid layer on /strategies.
//
// The free win-rate table above stays exactly as it was. This adds the deeper
// figures beside it rather than replacing anything.

function money(value: number | null): string {
  if (value === null) return "—";
  return `${value < 0 ? "−" : ""}$${Math.abs(value).toFixed(2)}`;
}

function r(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;
}

function pct(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(0)}%`;
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

function TrendRow({ label, stats }: { label: string; stats: SegmentStats }) {
  return (
    <tr className="border-t border-zinc-100 dark:border-subtle">
      <td className="py-1.5 text-zinc-600 dark:text-zinc-400">{label}</td>
      <td className="py-1.5 text-right font-mono text-zinc-500">{stats.trades}</td>
      <td className="py-1.5 text-right font-mono">{pct(stats.winRate)}</td>
      <td className="py-1.5 text-right font-mono">{r(stats.expectancy)}</td>
      <td className="py-1.5 text-right font-mono">{money(stats.totalPL)}</td>
    </tr>
  );
}

function Scorecard({ card }: { card: StrategyScorecard }) {
  const s = card.overall;

  return (
    <Card hoverable={false} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: card.strategy.color ?? "#a1a1aa" }}
          />
          {card.strategy.name}
          <span className="font-mono text-xs font-normal text-zinc-500">
            {s.trades} trades
          </span>
        </h3>
        <Link href={card.drillDownUrl} className="text-xs text-primary hover:underline">
          View these trades →
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Win rate" value={pct(s.winRate)} sub={`${s.wins}W / ${s.losses}L`} />
        <Stat label="Expectancy" value={r(s.expectancy)} sub={`over ${s.withR} with R`} />
        <Stat
          label="Profit factor"
          value={s.profitFactor === null ? "—" : s.profitFactor.toFixed(2)}
          sub={s.profitFactor === null ? "no losses yet" : undefined}
        />
        <Stat label="Total R" value={r(s.totalR)} />
        <Stat label="Avg winner" value={money(s.avgWin)} />
        <Stat label="Avg loser" value={s.avgLoss === null ? "—" : `−$${s.avgLoss.toFixed(2)}`} />
        <Stat label="Total P&L" value={money(s.totalPL)} />
        {/* Labelled explicitly: this is the strategy's own run of P&L, not
            what the account balance did while other strategies were open. */}
        <Stat label="Drawdown" value={money(s.maxDrawdown)} sub="this strategy alone" />
      </div>

      {card.trend && (
        <div className="border-t border-zinc-200 pt-3 dark:border-subtle">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
            Recent vs earlier
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-zinc-400">
                <th className="py-1 text-left font-medium">Half</th>
                <th className="py-1 text-right font-medium">Trades</th>
                <th className="py-1 text-right font-medium">Win rate</th>
                <th className="py-1 text-right font-medium">Expectancy</th>
                <th className="py-1 text-right font-medium">P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              <TrendRow label="Recent half" stats={card.trend.recent} />
              <TrendRow label="Earlier half" stats={card.trend.earlier} />
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-zinc-200 pt-3 text-xs dark:border-subtle">
        {card.bestCondition || card.worstCondition ? (
          <div className="flex flex-col gap-1">
            {card.bestCondition && (
              <p className="text-zinc-600 dark:text-zinc-400">
                <span className="text-profit">Best in</span> {card.bestCondition.value}{" "}
                <span className="text-zinc-500">
                  ({card.bestCondition.dimensionLabel}, {card.bestCondition.stats.trades} trades,{" "}
                  {r(card.bestCondition.stats.expectancy)})
                </span>
              </p>
            )}
            {card.worstCondition && (
              <p className="text-zinc-600 dark:text-zinc-400">
                <span className="text-loss">Worst in</span> {card.worstCondition.value}{" "}
                <span className="text-zinc-500">
                  ({card.worstCondition.dimensionLabel}, {card.worstCondition.stats.trades} trades,{" "}
                  {r(card.worstCondition.stats.expectancy)})
                </span>
              </p>
            )}
          </div>
        ) : (
          // Explained rather than left blank: the reason is sample size, and
          // it resolves itself as the strategy accumulates trades.
          <p className="text-zinc-500">
            No conditions to report yet. Splitting {s.trades} trades by day, risk band or exit
            behaviour leaves fewer than {MIN_SEGMENT_TRADES} in every group.
          </p>
        )}
        {!card.trend && (
          <p className="mt-1 text-zinc-500">
            Recent-vs-earlier needs {MIN_SEGMENT_TRADES} trades in each half.
          </p>
        )}
      </div>
    </Card>
  );
}

export function StrategyScorecards({ report }: { report: ScorecardReport }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Strategy scorecards
        </h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          The full picture for each strategy with enough trades to say anything. Every figure
          computed the same way as the Analytics page.
        </p>
      </div>

      {report.scorecards.length === 0 ? (
        <Card hoverable={false} className="text-sm text-zinc-500">
          No strategy has {MIN_SEGMENT_TRADES} closed trades yet. Tag more trades with a strategy
          and their scorecards appear here.
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {report.scorecards.map((card) => (
            <Scorecard key={card.strategy.id} card={card} />
          ))}
        </div>
      )}

      {report.belowFloor.length > 0 && (
        <p className="text-xs text-zinc-500">
          Not scored yet:{" "}
          {report.belowFloor
            .map((s) => `${s.name} (${s.trades} trade${s.trades === 1 ? "" : "s"})`)
            .join(", ")}
          . A scorecard needs at least {MIN_SEGMENT_TRADES} closed trades to be worth reading.
        </p>
      )}
    </div>
  );
}

/** What free users see in place of the scorecards. */
export function ScorecardUpsell() {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Strategy scorecards
        </h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          Expectancy, profit factor, average winner and loser, total R, drawdown, and how each
          strategy&apos;s recent trades compare with its earlier ones.
        </p>
      </div>
      <Card hoverable={false} className="flex flex-col gap-2">
        <p className="text-sm text-zinc-500">
          Available on the paid plan. The win-rate table above stays free.
        </p>
        <Link href="/#pricing" className="text-sm text-primary hover:underline">
          See plans
        </Link>
      </Card>
    </div>
  );
}
