"use client";

import type { Direction } from "@/lib/position-size/calculate";

// Inputs shared by the free calculators (/position-size-calculator,
// /risk-reward-calculator). Text inputs with inputMode="decimal" rather than
// type="number": a number input swallows "50." mid-typing and scrolls its
// value under a trackpad, and both feel broken in a calculator. text-base
// keeps iOS from zooming the page on focus.

export const DASH = "–";

/** "" and anything that isn't a number become null; the math decides what
 *  null means for each field. Commas are allowed so "10,000" works. */
export function parseNumber(value: string): number | null {
  const trimmed = value.replace(/,/g, "").trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export const CARD =
  "flex flex-col gap-5 rounded-xl border border-zinc-200 bg-white p-5 dark:border-subtle dark:bg-card sm:p-6";

export function DirectionToggle({
  name,
  value,
  onChange,
}: {
  name: string;
  value: Direction;
  onChange: (d: Direction) => void;
}) {
  return (
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
              name={name}
              value={d}
              checked={value === d}
              onChange={() => onChange(d)}
              className="sr-only"
            />
            {d === "long" ? "Long" : "Short"}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function NumberField({
  id,
  label,
  value,
  onChange,
  prefix,
  suffix,
  hint,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  prefix?: string;
  suffix?: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="flex items-baseline justify-between text-sm font-medium text-zinc-700 dark:text-zinc-300"
      >
        {label}
        {hint && <span className="text-xs font-normal text-zinc-500">{hint}</span>}
      </label>
      <div className="mt-1.5 flex items-center rounded-lg border border-zinc-300 bg-white px-3 transition-colors focus-within:border-primary focus-within:ring-1 focus-within:ring-primary dark:border-subtle dark:bg-deep">
        {prefix && <span className="text-zinc-500" aria-hidden="true">{prefix}</span>}
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full min-w-0 bg-transparent px-1.5 py-2.5 text-base tabular-nums text-zinc-900 outline-none dark:text-zinc-50"
        />
        {suffix && <span className="text-zinc-500" aria-hidden="true">{suffix}</span>}
      </div>
    </div>
  );
}

/** The always-present polite live region: an aria-live region added together
 *  with its text is often not announced, so this one is in the DOM from the
 *  first render and only its text changes. */
export function CalculatorMessage({ message }: { message: string }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={`text-sm ${message ? "rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" : "sr-only"}`}
    >
      {message}
    </p>
  );
}

export function StatList({ stats }: { stats: { label: string; value: string }[] }) {
  return (
    <dl className="flex flex-col divide-y divide-zinc-200 dark:divide-subtle">
      {stats.map((s) => (
        <div key={s.label} className="flex items-baseline justify-between gap-4 py-2">
          <dt className="text-sm text-zinc-600 dark:text-zinc-400">{s.label}</dt>
          <dd className="text-right text-sm font-medium tabular-nums text-zinc-900 dark:text-zinc-50">{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}
