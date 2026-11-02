"use client";

import { useId, useState } from "react";
import { CARD, NumberField, parseNumber } from "@/components/landing/calculator-fields";

// The "convert dollars to R" box on /what-is-an-r-multiple. One division, so
// no lib module of its own. Defaults are the journal guide's trade:
// +$172.20 on $98.40 of risk = +1.75R. Nothing is stored or sent.

export function RConverter() {
  const [pl, setPl] = useState("172.20");
  const [risk, setRisk] = useState("98.40");
  const id = useId();

  const plValue = parseNumber(pl);
  const riskValue = parseNumber(risk);
  const valid = plValue !== null && riskValue !== null && riskValue > 0;
  const r = valid ? plValue / riskValue : null;

  return (
    <div className={CARD}>
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">Convert dollars to R</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField id={`${id}-pl`} label="Profit or loss" prefix="$" value={pl} onChange={setPl} hint="Use − for a loss" />
        <NumberField id={`${id}-risk`} label="Planned risk" prefix="$" value={risk} onChange={setRisk} />
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {r === null ? (
          "Enter the result and the planned risk (above 0)."
        ) : (
          <>
            That trade made{" "}
            <span
              className={`text-2xl font-semibold tabular-nums ${r > 0 ? "text-profit" : r < 0 ? "text-loss" : "text-zinc-900 dark:text-zinc-50"}`}
            >
              {r > 0 ? "+" : r < 0 ? "−" : ""}
              {Math.abs(r).toFixed(2)}R
            </span>
          </>
        )}
      </p>
    </div>
  );
}
