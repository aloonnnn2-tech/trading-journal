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
import { calculatePositionSize, type Direction } from "@/lib/position-size/calculate";

// The interactive half of /position-size-calculator. Everything else on the
// page is server-rendered; this is the only client JS it ships.
//
// Inputs live in component state and nowhere else: no localStorage, no
// fetch. The brief is explicit that a visitor's account size is never stored
// or sent, and that is also the honest thing for a page anyone can open.
//
// The defaults render on the server too, so the HTML a crawler reads already
// carries a worked answer (41 shares) rather than a row of dashes.

const DEFAULTS = {
  account: "10000",
  riskPct: "1",
  entry: "50.40",
  stop: "48.00",
  target: "55.20",
};

type Field = keyof typeof DEFAULTS;

const FIELDS: { key: Field; label: string; prefix?: string; suffix?: string; hint?: string }[] = [
  { key: "account", label: "Account size", prefix: "$" },
  { key: "riskPct", label: "Risk per trade", suffix: "%" },
  { key: "entry", label: "Entry price", prefix: "$" },
  { key: "stop", label: "Stop price", prefix: "$" },
  { key: "target", label: "Target price", prefix: "$", hint: "Optional" },
];

export function PositionSizeCalculator() {
  const [direction, setDirection] = useState<Direction>("long");
  const [values, setValues] = useState<Record<Field, string>>(DEFAULTS);
  const id = useId();

  const result = calculatePositionSize({
    direction,
    account: parseNumber(values.account),
    riskPct: parseNumber(values.riskPct),
    entry: parseNumber(values.entry),
    stop: parseNumber(values.stop),
    target: parseNumber(values.target),
  });

  const r = result.ok ? result : null;
  const message = result.ok ? result.warnings.join(" ") : result.error;

  let rewardToRisk = DASH;
  let profitAtTarget = DASH;
  if (r?.target.kind === "ok") {
    rewardToRisk = `${r.target.rewardToRisk.toFixed(2)} : 1`;
    profitAtTarget = formatMoney(r.target.profitAtTarget, { sign: "always" });
  } else if (r?.target.kind === "wrong-side") {
    rewardToRisk = "Target is on the wrong side";
  }

  const stats: { label: string; value: string }[] = [
    { label: "Max risk", value: r ? formatMoney(r.maxRisk) : DASH },
    { label: "Risk per share (1R)", value: r ? formatMoney(r.riskPerShare) : DASH },
    { label: "Actual risk if stopped", value: r ? formatMoney(r.actualRisk) : DASH },
    { label: "Position value", value: r ? formatMoney(r.positionValue) : DASH },
    {
      label: "Position as % of account",
      value: r ? `${(r.positionPctOfAccount * 100).toFixed(1)}%` : DASH,
    },
    { label: "Reward : risk at target", value: rewardToRisk },
    { label: "Profit at target", value: profitAtTarget },
  ];

  const levels = r
    ? r.levels
    : ["Stop (−1R)", "1R", "2R", "3R"].map((label) => ({ label, price: null, pnl: null }));

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
              suffix={f.suffix}
              hint={f.hint}
              className={f.key === "target" ? "col-span-2" : undefined}
              value={values[f.key]}
              onChange={(value) => setValues((v) => ({ ...v, [f.key]: value }))}
            />
          ))}
        </div>
      </form>

      <section aria-label="Results" className={CARD}>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">Shares to buy</p>
          <p className="mt-1 text-5xl font-semibold tracking-tight tabular-nums text-zinc-900 transition-opacity dark:text-zinc-50">
            {r ? r.shares.toLocaleString("en-US") : DASH}
          </p>
        </div>

        <CalculatorMessage message={message} />
        <StatList stats={stats} />

        <table className="w-full text-sm tabular-nums">
          <caption className="mb-2 text-left font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">
            Price levels
          </caption>
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th scope="col" className="pb-1.5 font-medium">Level</th>
              <th scope="col" className="pb-1.5 text-right font-medium">Price</th>
              <th scope="col" className="pb-1.5 text-right font-medium">P/L</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-subtle">
            {levels.map((level) => (
              <tr key={level.label}>
                <th scope="row" className="py-1.5 text-left font-medium text-zinc-700 dark:text-zinc-300">
                  {level.label}
                </th>
                <td className="py-1.5 text-right text-zinc-900 dark:text-zinc-50">
                  {level.price === null ? DASH : formatMoney(level.price)}
                </td>
                <td
                  className={`py-1.5 text-right ${
                    level.pnl === null || level.pnl === 0
                      ? "text-zinc-900 dark:text-zinc-50"
                      : level.pnl < 0
                        ? "text-loss"
                        : "text-profit"
                  }`}
                >
                  {level.pnl === null ? DASH : formatMoney(level.pnl, { sign: "always" })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
