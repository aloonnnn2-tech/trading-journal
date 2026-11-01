"use client";

import { useId, useState } from "react";
import { CheckCircle2, Printer, RotateCcw } from "lucide-react";
import { CHECKLIST, CHECKLIST_COUNT } from "@/lib/free-tools/checklist";

// The interactive checklist on /trading-checklist. Ticks live in memory
// only: reload and it starts fresh, which is the point of a checklist you run
// before every trade. Nothing is stored or sent.
//
// Print shows just this card (header, footer and the rest of the page are
// print:hidden) with empty boxes, in black on white whatever the theme.

export function TradingChecklist() {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const id = useId();
  const count = checked.size;
  const ready = count === CHECKLIST_COUNT;

  function toggle(item: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return next;
    });
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-subtle dark:bg-card sm:p-6 print:border-0 print:bg-white print:p-0 print:**:text-black">
      <h2 className="hidden text-2xl font-semibold print:block">Pre-trade checklist</h2>
      <p className="hidden text-sm print:mt-1 print:block">Every box ticked, or no trade.</p>

      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <p
          aria-live="polite"
          className={`flex items-center gap-2 text-sm font-medium ${ready ? "text-profit" : "text-zinc-600 dark:text-zinc-400"}`}
        >
          {ready && <CheckCircle2 className="h-4 w-4" aria-hidden />}
          {ready ? "All clear. Ready to trade." : `${count} of ${CHECKLIST_COUNT} checked`}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setChecked(new Set())}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:border-primary hover:text-primary dark:border-subtle dark:text-zinc-400"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Reset
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:border-primary hover:text-primary dark:border-subtle dark:text-zinc-400"
          >
            <Printer className="h-3.5 w-3.5" aria-hidden />
            Print
          </button>
        </div>
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-subtle print:hidden" aria-hidden="true">
        <div
          className={`h-full transition-[width] duration-300 ${ready ? "bg-profit" : "bg-primary"}`}
          style={{ width: `${(count / CHECKLIST_COUNT) * 100}%` }}
        />
      </div>

      {CHECKLIST.map((group, g) => (
        <fieldset key={group.heading} className="mt-6">
          <legend className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">
            {group.heading}
          </legend>
          <ul className="mt-2 flex flex-col">
            {group.items.map((item, i) => {
              const inputId = `${id}-${g}-${i}`;
              return (
                <li key={item}>
                  <label
                    htmlFor={inputId}
                    className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-zinc-50 dark:hover:bg-white/5 print:px-0"
                  >
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={checked.has(item)}
                      onChange={() => toggle(item)}
                      className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
                    />
                    <span
                      className={`leading-snug transition-colors ${checked.has(item) ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-900 dark:text-zinc-100"}`}
                    >
                      {item}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}

      <p className="hidden text-xs print:mt-6 print:block">
        tradinglenz.netlify.app/trading-checklist · A trading journal and education tool. Not financial advice.
      </p>
    </div>
  );
}
