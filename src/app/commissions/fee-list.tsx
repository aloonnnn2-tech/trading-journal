"use client";

import { useId } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import type { CommissionRule } from "@/lib/commissions/types";
import { CHECKED_ON, findPreset } from "@/lib/commissions/presets";
import { EXAMPLE, describeRule, describeScope, exampleCost, formatFee } from "@/lib/commissions/fee-form";
import { Switch } from "@/components/ui/Switch";

// "Your fees": each rule in plain words, a worked example, and the controls
// people actually need -- on/off, edit, delete, and which one wins.

export function FeeList({
  rules,
  busyId,
  onToggle,
  onEdit,
  onDelete,
  onMove,
}: {
  rules: CommissionRule[];
  busyId: string | null;
  onToggle: (rule: CommissionRule) => void;
  onEdit: (rule: CommissionRule) => void;
  onDelete: (rule: CommissionRule) => void;
  onMove: (index: number, delta: -1 | 1) => void;
}) {
  if (rules.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700">
        <p className="font-medium text-zinc-900 dark:text-zinc-100">No fees yet</p>
        <p className="mt-1 text-sm text-zinc-500">
          Until you add one, every trade&apos;s P/L is recorded without fees. Press <strong>Add fees</strong> to pick your
          broker or enter your own.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {rules.map((rule, i) => (
        <FeeCard
          key={rule.id}
          rule={rule}
          first={i === 0}
          last={i === rules.length - 1}
          busy={busyId === rule.id}
          onToggle={() => onToggle(rule)}
          onEdit={() => onEdit(rule)}
          onDelete={() => onDelete(rule)}
          onUp={() => onMove(i, -1)}
          onDown={() => onMove(i, 1)}
        />
      ))}
      {rules.length > 1 && (
        <p className="text-xs text-zinc-500">
          Each trade uses the first fee in this list that fits it. Use the arrows to keep specific fees (like crypto only)
          above general ones.
        </p>
      )}
    </div>
  );
}

function FeeCard({
  rule,
  first,
  last,
  busy,
  onToggle,
  onEdit,
  onDelete,
  onUp,
  onDown,
}: {
  rule: CommissionRule;
  first: boolean;
  last: boolean;
  busy: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onUp: () => void;
  onDown: () => void;
}) {
  const titleId = useId();
  const preset = findPreset(rule.preset_id);
  const example = exampleCost(rule);
  const scoped = !!(rule.asset_type || rule.market);
  const arrow =
    "flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 hover:text-zinc-900 disabled:opacity-30 dark:border-subtle dark:hover:text-zinc-100";

  return (
    <div
      className={`flex gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-subtle dark:bg-card sm:gap-4 sm:p-5 ${
        rule.enabled ? "" : "opacity-60"
      }`}
    >
      <div className="flex flex-col gap-1">
        <button type="button" aria-label={`Move ${rule.name} up`} disabled={first || busy} onClick={onUp} className={arrow}>
          <ChevronUp className="h-4 w-4" />
        </button>
        <button type="button" aria-label={`Move ${rule.name} down`} disabled={last || busy} onClick={onDown} className={arrow}>
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span id={titleId} className="font-semibold text-zinc-900 dark:text-zinc-50">
            {rule.name}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] ${
              scoped ? "bg-primary/10 text-primary" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
            }`}
          >
            {describeScope(rule)}
          </span>
          {!rule.enabled && <span className="text-[11px] text-zinc-500">Off</span>}
        </div>
        <ul className="mt-1.5 flex flex-col gap-0.5 text-sm text-zinc-700 dark:text-zinc-300">
          {describeRule(rule).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-1.5 font-mono text-xs text-zinc-500">
          {EXAMPLE.shares} shares at ${EXAMPLE.price}: {formatFee(example.buy)} in + {formatFee(example.sell)} out ={" "}
          <span className="text-zinc-700 dark:text-zinc-300">{formatFee(example.total)}</span>
        </p>
        {preset && (
          <a
            href={preset.source}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-primary"
          >
            From {preset.broker}&apos;s published prices, checked {CHECKED_ON} <ExternalLink className="h-3 w-3" />
          </a>
        )}
        <div className="mt-3 flex items-center gap-4 sm:hidden">
          <Actions onEdit={onEdit} onDelete={onDelete} busy={busy} />
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-3">
        <Switch checked={rule.enabled} onChange={onToggle} disabled={busy} labelledBy={titleId} />
        <div className="hidden items-center gap-4 sm:flex">
          <Actions onEdit={onEdit} onDelete={onDelete} busy={busy} />
        </div>
      </div>
    </div>
  );
}

function Actions({ onEdit, onDelete, busy }: { onEdit: () => void; onDelete: () => void; busy: boolean }) {
  return (
    <>
      <button type="button" onClick={onEdit} disabled={busy} className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
        Edit
      </button>
      <button type="button" onClick={onDelete} disabled={busy} className="text-sm text-loss hover:underline">
        Delete
      </button>
    </>
  );
}
