"use client";

import Link from "next/link";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/Card";
import type { EquityCurve } from "@/lib/equity/build";

// Trading performance against account growth.
//
// The two lines answer different questions and are deliberately on different
// axes: the balance says how much money is there, and cumulative R says
// whether the trading is working. On an account funded by deposits those move
// almost independently, which is the thing worth seeing.

function money(value: number): string {
  return `${value < 0 ? "−" : ""}$${Math.abs(value).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  })}`;
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

export function PerformancePanel({ curve }: { curve: EquityCurve }) {
  if (curve.points.length === 0) {
    return (
      <Card hoverable={false} className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          Performance vs account growth
        </h2>
        <p className="text-sm text-zinc-500">
          No closed trades or cash movements yet.
        </p>
      </Card>
    );
  }

  // How much of the balance is money put in rather than money made -- the
  // single most useful number on this panel.
  const fromTrading =
    curve.finalEquity !== 0 ? curve.finalPL / curve.finalEquity : null;

  return (
    <Card hoverable={false} className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          Performance vs account growth
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Your balance grows from deposits as well as from trading. Cumulative R is the same
          whatever the account size, so it is the line that says whether the trading works.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Account balance" value={money(curve.finalEquity)} />
        <Stat label="Net deposited" value={money(curve.netDeposits)} sub="money you put in" />
        <Stat
          label="From trading"
          value={money(curve.finalPL)}
          sub={fromTrading === null ? undefined : `${(fromTrading * 100).toFixed(0)}% of the balance`}
        />
        <Stat
          label="Cumulative R"
          value={`${curve.finalR >= 0 ? "+" : ""}${curve.finalR.toFixed(1)}R`}
          sub={`over ${curve.tradesWithR} of ${curve.trades} trades`}
        />
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={curve.points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="equityWash2" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-subtle)" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={40} />
            {/* Two axes, because dollars and R are not comparable quantities
                and forcing them onto one scale would make the smaller line
                look flat regardless of what it did. */}
            <YAxis yAxisId="money" tick={{ fontSize: 11 }} width={70} />
            <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} width={50} />
            <Tooltip
              formatter={(value, name) => {
                const amount = Number(value);
                if (name === "cumulativeR") {
                  return [`${amount >= 0 ? "+" : ""}${amount.toFixed(1)}R`, "Cumulative R"];
                }
                return [
                  money(amount),
                  name === "accountEquity" ? "Account balance" : "From trading",
                ];
              }}
            />
            <Area
              yAxisId="money"
              type="monotone"
              dataKey="accountEquity"
              stroke="var(--color-primary)"
              strokeWidth={1.5}
              fill="url(#equityWash2)"
              dot={false}
            />
            <Line
              yAxisId="money"
              type="monotone"
              dataKey="cumulativePL"
              stroke="var(--color-profit)"
              strokeWidth={1.5}
              dot={false}
            />
            <Line
              yAxisId="r"
              type="monotone"
              dataKey="cumulativeR"
              stroke="var(--color-loss)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-full bg-primary" /> Account balance
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-full bg-profit" /> From trading
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-full bg-loss" /> Cumulative R (right axis)
        </span>
      </div>

      <div className="border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-subtle">
        <p>
          Deepest trading drawdown {money(curve.maxDrawdown)}
          {curve.maxDrawdownPercent !== null && (
            <> · {(curve.maxDrawdownPercent * 100).toFixed(1)}% of the account at that point</>
          )}
          . Measured on the trading line only, so a withdrawal never counts as a drawdown and a
          deposit never heals one.
        </p>
        {curve.tradesWithR < curve.trades && (
          // The two lines do not rest on the same trades, and implying they do
          // would overstate what the R line covers.
          <p className="mt-1.5">
            {curve.trades - curve.tradesWithR} trade
            {curve.trades - curve.tradesWithR === 1 ? "" : "s"} recorded no R multiple, so the R
            line covers {curve.tradesWithR} of {curve.trades}.
          </p>
        )}
      </div>
    </Card>
  );
}

/** What free users see in place of the panel. */
export function PerformanceUpsell() {
  return (
    <Card hoverable={false} className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
        Performance vs account growth
      </h2>
      <p className="text-sm text-zinc-500">
        Separate what your account did from what your trading did: balance, deposits, profit and
        cumulative R side by side, with drawdown measured so a withdrawal never looks like a
        losing streak. Available on the paid plan.
      </p>
      <Link href="/#pricing" className="text-sm text-primary hover:underline">
        See plans
      </Link>
    </Card>
  );
}
