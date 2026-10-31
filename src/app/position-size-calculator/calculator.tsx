"use client";

import { useId, useState } from "react";
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

const DASH = "–";

const DEFAULTS = {
  account: "10000",
  riskPct: "1",
  entry: "50.40",
  stop: "48.00",
  target: "55.20",
};

type Field = keyof typeof DEFAULTS;

/** "" and anything that isn't a number become null; the math decides what
 *  null means for each field. Commas are allowed so "10,000" works. */
function parse(value: string): number | null {
  const trimmed = value.replace(/,/g, "").trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function PositionSizeCalculator() {
  const [direction, setDirection] = useState<Direction>("long");
  const [values, setValues] = useState<Record<Field, string>>(DEFAULTS);
  const id = useId();

  const result = calculatePositionSize({
    direction,
    account: parse(values.account),
    riskPct: parse(values.riskPct),
    entry: parse(values.entry),
    stop: parse(values.stop),
    target: parse(values.target),
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

  const fields: { key: Field; label: string; prefix?: string; suffix?: string; hint?: string }[] = [
    { key: "account", label: "Account size", prefix: "$" },
    { key: "riskPct", label: "Risk per trade", suffix: "%" },
    { key: "entry", label: "Entry price", prefix: "$" },
    { key: "stop", label: "Stop price", prefix: "$" },
    { key: "target", label: "Target price", prefix: "$", hint: "Optional" },
  ];

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <form
        onSubmit={(e) => e.preventDefault()}
        className="flex flex-col gap-5 rounded-xl border border-zinc-200 bg-white p-5 dark:border-subtle dark:bg-card sm:p-6"
        aria-label="Trade details"
      >
        <fieldset>
          <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Direction</legend>
          <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg border border-zinc-200 p-1 dark:border-subtle">
            {(["long", "short"] as const).map((d) => (
              <label
                key={d}
                className="cursor-pointer rounded-md py-2 text-center text-sm font-medium text-zinc-600 transition-colors has-checked:bg-primary has-checked:text-white has-focus-visible:ring-2 has-focus-visible:ring-primary dark:text-zinc-400 dark:has-checked:text-zinc-950"
              >
                <input
                  type="radio"
                  name={`${id}-direction`}
                  value={d}
                  checked={direction === d}
                  onChange={() => setDirection(d)}
                  className="sr-only"
                />
                {d === "long" ? "Long" : "Short"}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-4">
          {fields.map((f) => (
            <div key={f.key} className={f.key === "target" ? "col-span-2" : undefined}>
              <label
                htmlFor={`${id}-${f.key}`}
                className="flex items-baseline justify-between text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                {f.label}
                {f.hint && <span className="text-xs font-normal text-zinc-500">{f.hint}</span>}
              </label>
              <div className="mt-1.5 flex items-center rounded-lg border border-zinc-300 bg-white px-3 transition-colors focus-within:border-primary focus-within:ring-1 focus-within:ring-primary dark:border-subtle dark:bg-deep">
                {f.prefix && <span className="text-zinc-500" aria-hidden="true">{f.prefix}</span>}
                <input
                  id={`${id}-${f.key}`}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={values[f.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  className="w-full min-w-0 bg-transparent px-1.5 py-2.5 text-base tabular-nums text-zinc-900 outline-none dark:text-zinc-50"
                />
                {f.suffix && <span className="text-zinc-500" aria-hidden="true">{f.suffix}</span>}
              </div>
            </div>
          ))}
        </div>
      </form>

      <section
        aria-label="Results"
        className="flex flex-col gap-5 rounded-xl border border-zinc-200 bg-white p-5 dark:border-subtle dark:bg-card sm:p-6"
      >
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">Shares to buy</p>
          <p className="mt-1 text-5xl font-semibold tracking-tight tabular-nums text-zinc-900 transition-opacity dark:text-zinc-50">
            {r ? r.shares.toLocaleString("en-US") : DASH}
          </p>
        </div>

        {/* Always in the DOM, so screen readers are listening before the
            first message arrives; an aria-live region added together with
            its text is often not announced. */}
        <p
          role="status"
          aria-live="polite"
          className={`text-sm ${message ? "rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" : "sr-only"}`}
        >
          {message}
        </p>

        <dl className="flex flex-col divide-y divide-zinc-200 dark:divide-subtle">
          {stats.map((s) => (
            <div key={s.label} className="flex items-baseline justify-between gap-4 py-2">
              <dt className="text-sm text-zinc-600 dark:text-zinc-400">{s.label}</dt>
              <dd className="text-right text-sm font-medium tabular-nums text-zinc-900 dark:text-zinc-50">
                {s.value}
              </dd>
            </div>
          ))}
        </dl>

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
            {(r ? r.levels : ["Stop (−1R)", "1R", "2R", "3R"].map((label) => ({ label, price: null, pnl: null }))).map(
              (level) => (
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
              ),
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
