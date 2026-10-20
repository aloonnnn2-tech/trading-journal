"use client";

import { useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/format/money";
import type { EmotionRow, Phase } from "@/lib/emotions/report";
import { formatR, pct } from "@/lib/emotions/format";

// Results by emotion, one row each. On a phone the four figures wrap under
// the name with their own labels instead of scrolling sideways.

const GRID = "grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-[minmax(9rem,1fr)_4.5rem_4.5rem_5.5rem_6.5rem_4.5rem] sm:items-center";

export function StatHeader({ first }: { first: string }) {
  return (
    <div className={`${GRID} hidden border-b border-zinc-100 pb-1.5 text-[11px] uppercase tracking-wide text-zinc-400 dark:border-subtle dark:text-zinc-500 sm:grid`}>
      <span>{first}</span>
      <span className="text-right">Trades</span>
      <span className="text-right">Win rate</span>
      <span className="text-right">Avg R</span>
      <span className="text-right">Total P/L</span>
      <span className="text-right">PF</span>
    </div>
  );
}

function Cell({ label, children, tone }: { label: string; children: React.ReactNode; tone?: string }) {
  return (
    <span className={`tnum font-mono text-sm sm:text-right ${tone ?? "text-zinc-600 dark:text-zinc-400"}`}>
      <span className="mr-1 font-sans text-[11px] text-zinc-400 sm:hidden">{label}</span>
      {children}
    </span>
  );
}

export function StatRow({ row, link = true }: { row: EmotionRow; link?: boolean }) {
  const s = row.stats;
  const name = link ? (
    <Link href={row.href} className="text-zinc-900 hover:text-primary dark:text-zinc-100">
      {row.emotion}
    </Link>
  ) : (
    <span className="text-zinc-900 dark:text-zinc-100">{row.emotion}</span>
  );
  return (
    <div className={`${GRID} border-b border-zinc-100 py-2 last:border-0 dark:border-subtle ${row.thin ? "opacity-60" : ""}`}>
      <span className="col-span-2 flex items-baseline gap-2 text-sm sm:col-span-1">
        {name}
        {row.thin && <span className="text-[11px] text-zinc-500">few trades</span>}
      </span>
      <Cell label="Trades">{s.trades}</Cell>
      <Cell label="Win">{pct(s.winRate)}</Cell>
      <Cell label="Avg R">{s.withR > 0 ? formatR(s.expectancy) : "—"}</Cell>
      <Cell label="P/L" tone={s.totalPL >= 0 ? "text-profit" : "text-loss"}>
        {formatMoney(s.totalPL, { sign: "always" })}
      </Cell>
      <Cell label="PF">{s.profitFactor == null ? "—" : s.profitFactor.toFixed(2)}</Cell>
    </div>
  );
}

const PHASE_LABELS: Record<Phase, string> = { before: "Before entering", during: "During", after: "After exiting" };

export function PhaseTabs({ byPhase }: { byPhase: Record<Phase, EmotionRow[]> }) {
  const [phase, setPhase] = useState<Phase>("before");
  const rows = byPhase[phase];
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="When the emotion was logged" className="flex flex-wrap gap-1.5">
        {(Object.keys(PHASE_LABELS) as Phase[]).map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={p === phase}
            onClick={() => setPhase(p)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              p === phase
                ? "border-primary bg-primary/10 text-primary"
                : "border-zinc-300 text-zinc-600 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-300"
            }`}
          >
            {PHASE_LABELS[p]} ({byPhase[p].length})
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No emotions logged at this point of a trade yet.</p>
      ) : (
        <div role="tabpanel">
          <StatHeader first="Emotion" />
          {rows.map((row) => (
            <StatRow key={row.emotion} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
