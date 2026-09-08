import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { MIN_COMPARISON, OUTLIER_MULTIPLE, type Comparison } from "@/lib/risk/analyze";
import type { FullRiskReport } from "@/lib/risk/queries";

// The risk dashboard -- the paid risk section of /analytics.
//
// **Describes, never prescribes.** There is no correct risk percentage, so
// nothing here says what the trader's should be. Every comparison is against
// their own distribution, and the pairs are presented as observations ("risk
// after a loss runs higher than after a win") rather than as instructions.

/** How many outliers to list before it stops being a finding and starts being
 *  a second copy of the trade list. */
const MAX_OUTLIERS_SHOWN = 8;

function pct(value: number | null, digits = 2): string {
  return value === null ? "—" : `${value.toFixed(digits)}%`;
}

function money(value: number | null): string {
  return value === null ? "—" : `$${value.toFixed(0)}`;
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

/** A pair of cohorts side by side. Both means are withheld until each side has
 *  enough trades, and the sample sizes always travel with the figures. */
function Pair({ a, b, note }: { a: Comparison; b: Comparison; note: string }) {
  const comparable = a.mean !== null && b.mean !== null;

  return (
    <div className="border-t border-zinc-200 py-3 dark:border-subtle">
      <div className="grid grid-cols-2 gap-3">
        {[a, b].map((side) => (
          <div key={side.label}>
            <p className="text-[11px] uppercase tracking-wider text-zinc-500">{side.label}</p>
            <p className="mt-0.5 font-mono text-sm text-zinc-900 dark:text-zinc-100">
              {pct(side.mean)}
            </p>
            <p className="text-[11px] text-zinc-500">
              {side.n} trade{side.n === 1 ? "" : "s"}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-zinc-500">
        {comparable
          ? note
          : `Needs at least ${MIN_COMPARISON} trades on each side before these averages mean anything.`}
      </p>
    </div>
  );
}

export function RiskPanel({ report }: { report: FullRiskReport }) {
  const { risk } = report;
  const maxBand = Math.max(1, ...report.distribution.map((b) => b.trades));

  if (risk.n === 0) {
    return (
      <Card hoverable={false} className="flex flex-col gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          <ShieldAlert className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
          Risk management
        </h2>
        {/* Two sentences, because "none of your 0 closed trades" is what the
            one-size version said to every brand-new account -- true, and
            written by a computer. A new user needs to be told to log a trade,
            not that zero of them are missing a field. */}
        <p className="text-sm text-zinc-500">
          {report.tradesConsidered === 0 ? (
            <>
              Nothing to measure yet. You have no closed trades. Fill in Risk % as you log them
              and this fills in on its own.
            </>
          ) : (
            <>
              None of your {report.tradesConsidered} closed trade
              {report.tradesConsidered === 1 ? "" : "s"} records a risk percentage, so there is
              nothing to measure yet. Fill in Risk % on a trade and it appears here.
            </>
          )}
        </p>
      </Card>
    );
  }

  return (
    <Card hoverable={false} className="flex flex-col gap-3">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          <ShieldAlert className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
          Risk management
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          How much you risked, how consistently, and whether it moved with circumstances.
          Everything below is measured against your own history. There is no target here.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Median risk" value={pct(risk.median)} sub={`over ${risk.n} trades`} />
        <Stat label="Average" value={pct(risk.mean)} />
        <Stat label="Range" value={`${pct(risk.min)} – ${pct(risk.max)}`} />
        <Stat
          label="Spread"
          value={risk.stdev === null ? "—" : `±${risk.stdev.toFixed(2)}%`}
          sub="standard deviation"
        />
      </div>

      <div className="flex flex-col gap-1 border-t border-zinc-200 pt-3 dark:border-subtle">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
          Distribution
        </p>
        {report.distribution.map((band) => (
          <div key={band.label} className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-xs text-zinc-500">{band.label}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${(band.trades / maxBand) * 100}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
              {band.trades}
            </span>
          </div>
        ))}
      </div>

      <Pair
        a={report.sequence.afterLoss}
        b={report.sequence.afterWin}
        note="Risk on the trade that followed each result. A gap here is a behavioural pattern, not a rule being broken."
      />

      <Pair
        a={report.drawdown.inDrawdown}
        b={report.drawdown.atHighs}
        note="Classified by where the account stood before each trade was taken, not by how it turned out."
      />

      <Pair
        a={report.outcome.losers}
        b={report.outcome.winners}
        note="Risk on trades by how they finished. Descriptive only. Sizing up does not cause a loss, and this pair does not show that it does."
      />

      <div className="border-t border-zinc-200 pt-3 dark:border-subtle">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
          Position sizing
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Median size" value={money(report.positionSize.median)} />
          <Stat label="Range" value={`${money(report.positionSize.min)} – ${money(report.positionSize.max)}`} />
          <Stat
            label="Variation"
            value={
              report.positionSizeVariation === null
                ? "—"
                : `${(report.positionSizeVariation * 100).toFixed(0)}%`
            }
            sub="relative to your average"
          />
          <Stat label="Sizes recorded" value={`${report.positionSize.n}`} />
        </div>
      </div>

      {report.byStrategy.length > 0 && (
        <div className="overflow-x-auto border-t border-zinc-200 pt-3 dark:border-subtle">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
            Risk by strategy
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-zinc-400">
                <th className="py-1 text-left font-medium">Strategy</th>
                <th className="py-1 text-right font-medium">Trades</th>
                <th className="py-1 text-right font-medium">Median</th>
                <th className="py-1 text-right font-medium">Largest</th>
              </tr>
            </thead>
            <tbody>
              {report.byStrategy.map(({ strategy, risk: r }) => (
                <tr key={strategy} className="border-t border-zinc-100 dark:border-subtle">
                  <td className="py-1.5">{strategy}</td>
                  <td className="py-1.5 text-right font-mono text-zinc-500">{r.n}</td>
                  <td className="py-1.5 text-right font-mono">{pct(r.median)}</td>
                  <td className="py-1.5 text-right font-mono">{pct(r.max)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report.outliers.length > 0 && (
        <div className="border-t border-zinc-200 pt-3 dark:border-subtle">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
            Unusually large for you
          </p>
          <ul className="flex flex-col gap-1">
            {report.outliers.slice(0, MAX_OUTLIERS_SHOWN).map((o) => (
              <li key={o.tradeId} className="flex items-center justify-between gap-3 text-sm">
                <Link href={`/trades/${o.tradeId}`} className="font-mono text-primary hover:underline">
                  {o.ticker || "—"}
                </Link>
                <span className="text-xs text-zinc-500">
                  {new Date(o.exitDate).toLocaleDateString()}
                </span>
                <span className="font-mono text-sm text-loss">
                  {pct(o.riskPercent)}
                  <span className="ml-1.5 text-[11px] text-zinc-500">
                    {o.timesMedian.toFixed(1)}× your median
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-zinc-500">
            {report.outliers.length} trade{report.outliers.length === 1 ? "" : "s"} risked more
            than {OUTLIER_MULTIPLE}× your median of {pct(risk.median)}. Flagged relative to your
            own sizing, not against any external rule about what risk should be.
          </p>
        </div>
      )}
    </Card>
  );
}

/** What free users see in place of the panel. */
export function RiskUpsell() {
  return (
    <Card hoverable={false} className="flex flex-col gap-2">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
        <ShieldAlert className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
        Risk management
      </h2>
      <p className="text-sm text-zinc-500">
        Your risk distribution, position-size consistency, whether you size up after losses or
        during drawdowns, and which trades were unusually large for you. Available on the paid
        plan.
      </p>
      <Link href="/#pricing" className="text-sm text-primary hover:underline">
        See plans
      </Link>
    </Card>
  );
}
