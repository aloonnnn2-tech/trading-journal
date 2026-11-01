"use client";

import { useId, useState } from "react";
import {
  CalculatorMessage,
  CARD,
  DASH,
  DirectionToggle,
  NumberField,
  parseNumber,
  StatList,
} from "@/components/landing/calculator-fields";
import { formatMoney } from "@/lib/format/money";
import type { Direction } from "@/lib/position-size/calculate";
import { calculateRiskReward } from "@/lib/risk-reward/calculate";

// The interactive half of /risk-reward-calculator. Inputs stay in component
// state: nothing is stored or sent. The defaults are the same trade as the
// position size calculator and the journal guide, so the three pages agree
// (2.00 : 1, break-even at 33.3%).

const DEFAULTS = { entry: "50.40", stop: "48.00", target: "55.20", shares: "" };

type Field = keyof typeof DEFAULTS;

const FIELDS: { key: Field; label: string; hint?: string; prefix?: string }[] = [
  { key: "entry", label: "Entry price", prefix: "$" },
  { key: "stop", label: "Stop price", prefix: "$" },
  { key: "target", label: "Target price", prefix: "$" },
  { key: "shares", label: "Shares", hint: "Optional" },
];

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function RiskRewardCalculator() {
  const [direction, setDirection] = useState<Direction>("long");
  const [values, setValues] = useState<Record<Field, string>>(DEFAULTS);
  const id = useId();

  const result = calculateRiskReward({
    direction,
    entry: parseNumber(values.entry),
    stop: parseNumber(values.stop),
    target: parseNumber(values.target),
    shares: parseNumber(values.shares),
  });
  const r = result.ok ? result : null;

  const stats = [
    { label: "Break-even win rate", value: r ? pct(r.breakEvenWinRate) : DASH },
    { label: "Risk per share", value: r ? formatMoney(r.riskPerShare) : DASH },
    { label: "Reward per share", value: r ? formatMoney(r.rewardPerShare) : DASH },
    { label: "Distance to stop", value: r ? pct(r.stopPct) : DASH },
    { label: "Distance to target", value: r ? pct(r.targetPct) : DASH },
    {
      label: "Dollar risk",
      value: r?.dollars ? formatMoney(r.dollars.risk) : r ? "Add shares" : DASH,
    },
    {
      label: "Dollar reward",
      value: r?.dollars ? formatMoney(r.dollars.reward) : r ? "Add shares" : DASH,
    },
  ];

  // The bar's two halves in proportion: a 2 : 1 trade is one third risk, two
  // thirds reward. Purely visual; the numbers above say the same thing.
  const riskShare = r ? 1 / (1 + r.rewardToRisk) : 0.5;

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <form onSubmit={(e) => e.preventDefault()} className={CARD} aria-label="Trade details">
        <DirectionToggle name={`${id}-direction`} value={direction} onChange={setDirection} />
        <div className="grid grid-cols-2 gap-4">
          {FIELDS.map((f) => (
            <NumberField
              key={f.key}
              id={`${id}-${f.key}`}
              label={f.label}
              prefix={f.prefix}
              hint={f.hint}
              value={values[f.key]}
              onChange={(value) => setValues((v) => ({ ...v, [f.key]: value }))}
            />
          ))}
        </div>
      </form>

      <section aria-label="Results" className={CARD}>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">Reward : risk</p>
          <p className="mt-1 text-5xl font-semibold tracking-tight tabular-nums text-zinc-900 dark:text-zinc-50">
            {r ? `${r.rewardToRisk.toFixed(2)} : 1` : DASH}
          </p>
          <div className="mt-4 flex h-2.5 overflow-hidden rounded-full" aria-hidden="true">
            <div
              className={`transition-[width] duration-300 ${r ? "bg-loss" : "bg-zinc-200 dark:bg-subtle"}`}
              style={{ width: `${riskShare * 100}%` }}
            />
            <div
              className={`flex-1 transition-[width] duration-300 ${r ? "bg-profit" : "bg-zinc-200 dark:bg-subtle"}`}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-zinc-500" aria-hidden="true">
            <span>Risk</span>
            <span>Reward</span>
          </div>
        </div>

        <CalculatorMessage message={result.ok ? "" : result.error} />
        <StatList stats={stats} />
      </section>
    </div>
  );
}
