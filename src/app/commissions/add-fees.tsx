"use client";

import { useMemo, useState } from "react";
import { PencilLine, Search } from "lucide-react";
import {
  BROKER_PRESETS,
  CHECKED_ON,
  CUSTOM_TEMPLATES,
  PRESET_CATEGORY_LABELS,
  type BrokerPreset,
  type PresetCategory,
} from "@/lib/commissions/presets";
import { describeRule, previewRule, formFromComponents } from "@/lib/commissions/fee-form";

// Step one of adding fees: your broker, or your own. Picking a broker opens
// the same form "Create my own" does, filled in -- so the numbers are always
// seen and checked before anything is saved.

const CATEGORIES = Object.keys(PRESET_CATEGORY_LABELS) as PresetCategory[];

/** One line for a preset, from the same wording the fee list uses. */
function summarise(p: BrokerPreset): string {
  if (p.components.length === 0) return "No fees";
  return describeRule(previewRule(formFromComponents(p.components))).join(" · ");
}

export function AddFees({
  onPickPreset,
  onCreateOwn,
  onPickTemplate,
  onCancel,
}: {
  onPickPreset: (preset: BrokerPreset) => void;
  onCreateOwn: () => void;
  /** A common setup to start "Create my own" from. */
  onPickTemplate: (template: (typeof CUSTOM_TEMPLATES)[number]) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<PresetCategory | "all">("all");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return BROKER_PRESETS.filter(
      (p) =>
        (category === "all" || p.category === category) &&
        (!q || `${p.broker} ${p.plan}`.toLowerCase().includes(q)),
    );
  }, [query, category]);

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-xs ${
      active
        ? "border-primary bg-primary/10 text-zinc-900 dark:text-zinc-50"
        : "border-zinc-300 text-zinc-600 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
    }`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Add fees</h2>
        <button type="button" onClick={onCancel} className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          Cancel
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-primary bg-primary/[0.06] p-4 sm:p-5">
          <p className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-zinc-50">
            <Search className="h-5 w-5 text-primary" /> Pick my broker
          </p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {BROKER_PRESETS.length} brokers, prices read on each broker&apos;s own site on {CHECKED_ON}. Search below.
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateOwn}
          className="rounded-xl border border-zinc-200 bg-white p-4 text-left hover:border-primary/60 dark:border-subtle dark:bg-card sm:p-5"
        >
          <span className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-zinc-50">
            <PencilLine className="h-5 w-5 text-primary" /> Create my own
          </span>
          <span className="mt-1 block text-sm text-zinc-600 dark:text-zinc-400">
            Any fee: a fixed amount, per share, or a % of the trade. For banks (including Israeli banks) and brokers that
            aren&apos;t listed.
          </span>
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Or create your own from a common setup:</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {CUSTOM_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onPickTemplate(t)}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-left hover:border-primary/60 dark:border-subtle dark:bg-card"
            >
              <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-50">{t.name}</span>
              <span className="mt-0.5 block text-xs text-zinc-500">{t.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-subtle dark:bg-card sm:p-5">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Pick my broker</p>
        <label className="flex items-center gap-2 rounded-lg border border-zinc-300 bg-zinc-50 px-3 dark:border-zinc-700 dark:bg-zinc-950">
          <Search className="h-4 w-4 shrink-0 text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your broker, e.g. Schwab, IBKR, eToro"
            aria-label="Search brokers"
            className="w-full bg-transparent py-2.5 text-sm text-zinc-900 outline-none dark:text-zinc-100"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setCategory("all")} className={chip(category === "all")}>
            All
          </button>
          {CATEGORIES.map((c) => (
            <button key={c} type="button" onClick={() => setCategory(c)} className={chip(category === c)}>
              {PRESET_CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>

        <ul className="flex flex-col">
          {results.map((p) => (
            <li
              key={p.id}
              className="flex flex-col gap-2 border-t border-zinc-100 py-3 dark:border-zinc-800/70 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {p.broker} <span className="font-normal text-zinc-500">· {p.plan}</span>
                </p>
                <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">{summarise(p)}</p>
                {p.note && <p className="mt-0.5 text-xs text-zinc-500">{p.note}</p>}
              </div>
              <button
                type="button"
                onClick={() => onPickPreset(p)}
                className="shrink-0 self-start rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:border-primary dark:border-zinc-700 dark:text-zinc-100 sm:self-auto"
              >
                Use this
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="border-t border-zinc-100 py-4 text-sm text-zinc-500 dark:border-zinc-800/70">
              No broker matches.{" "}
              <button type="button" onClick={onCreateOwn} className="text-primary hover:underline">
                Create your own fee instead →
              </button>
            </li>
          )}
        </ul>
        <p className="text-xs text-zinc-500">
          &quot;Use this&quot; opens the fee filled in, so you can check the numbers match your account before saving.
        </p>
      </div>
    </div>
  );
}
