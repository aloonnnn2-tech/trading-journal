"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { ExternalLink, Plus, Pencil, Trash2, RefreshCw, X } from "lucide-react";
import type { CommissionRule, CommissionRuleType, FeeComponent, FeeSide } from "@/lib/commissions/types";
import { FEE_SIDE_LABELS, RULE_TYPE_LABELS } from "@/lib/commissions/types";
import {
  BROKER_PRESETS,
  CHECKED_ON,
  CUSTOM_TEMPLATES,
  PRESET_CATEGORY_LABELS,
  findPreset,
  type PresetCategory,
} from "@/lib/commissions/presets";
import { FormError } from "@/components/form-error";

const inputClass =
  "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary";
const labelClass = "mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400";

// A rule is a name, an optional scope, and one or more FEE LINES -- a broker's
// commission, the SEC fee, FINRA's TAF, an FX charge. One plain line saves as
// an old-style single-line rule (so it works before migration 0055); anything
// richer saves as `components`.

interface LineForm {
  label: string;
  basis: CommissionRuleType;
  amount: string;
  side: FeeSide;
  min_fee: string;
  max_fee: string;
  max_percent: string;
}

interface RuleForm {
  name: string;
  asset_type: string;
  market: string;
  lines: LineForm[];
  preset_id: string | null;
}

const BLANK_LINE: LineForm = {
  label: "Commission",
  basis: "flat",
  amount: "",
  side: "both",
  min_fee: "",
  max_fee: "",
  max_percent: "",
};

const BLANK: RuleForm = { name: "", asset_type: "", market: "", lines: [BLANK_LINE], preset_id: null };

const str = (v: number | null | undefined) => (v == null ? "" : String(v));
const num = (v: string) => (v.trim() === "" ? null : Number(v));

function lineFromComponent(c: FeeComponent): LineForm {
  return {
    label: c.label,
    basis: c.basis,
    amount: c.amount === 0 ? "" : String(c.amount),
    side: c.side,
    min_fee: str(c.min_fee),
    max_fee: str(c.max_fee),
    max_percent: str(c.max_percent),
  };
}

function toForm(rule: CommissionRule): RuleForm {
  const lines =
    rule.components && rule.components.length > 0
      ? rule.components.map(lineFromComponent)
      : [
          {
            label: "Commission",
            basis: rule.rule_type,
            amount: String(rule.amount),
            side: rule.applies_to,
            min_fee: str(rule.min_fee),
            max_fee: str(rule.max_fee),
            max_percent: "",
          },
        ];
  return {
    name: rule.name,
    asset_type: rule.asset_type ?? "",
    market: rule.market ?? "",
    lines,
    preset_id: rule.preset_id ?? null,
  };
}

function toComponent(l: LineForm): FeeComponent {
  return {
    label: l.label.trim() || "Fee",
    basis: l.basis,
    amount: Number(l.amount || 0),
    side: l.side,
    min_fee: num(l.min_fee),
    max_fee: num(l.max_fee),
    max_percent: num(l.max_percent),
  };
}

function toPayload(form: RuleForm, enabled: boolean) {
  const base = {
    name: form.name.trim(),
    asset_type: form.asset_type.trim() || null,
    market: form.market.trim() || null,
    enabled,
    preset_id: form.preset_id,
  };
  // One plain line is exactly what a 0022 rule can hold: save it that way, so
  // it works whether or not 0055 has been applied.
  const [only] = form.lines;
  const plain =
    form.lines.length <= 1 && (!only || ((only.side === "both" || only.side === "entry" || only.side === "exit") && !only.max_percent.trim()));
  if (plain) {
    return {
      ...base,
      rule_type: only?.basis ?? "flat",
      amount: Number(only?.amount || 0),
      applies_to: (only?.side ?? "both") as "both" | "entry" | "exit",
      min_fee: only ? num(only.min_fee) : null,
      max_fee: only ? num(only.max_fee) : null,
      components: null,
    };
  }
  return {
    ...base,
    rule_type: "flat" as const,
    amount: 0,
    applies_to: "both" as const,
    min_fee: null,
    max_fee: null,
    components: form.lines.map(toComponent),
  };
}

function describeLine(c: Pick<FeeComponent, "basis" | "amount" | "side" | "min_fee" | "max_fee" | "max_percent">): string {
  const amount =
    c.basis === "percent" ? `${c.amount}% of value` : c.basis === "per_unit" ? `$${c.amount}/share` : `$${c.amount}`;
  const side = { both: "", entry: " on entry", exit: " on exit", buy: " on buys", sell: " on sells" }[c.side];
  const limits = [
    c.min_fee != null ? `min $${c.min_fee}` : null,
    c.max_fee != null ? `max $${c.max_fee}` : null,
    c.max_percent != null ? `max ${c.max_percent}% of value` : null,
  ].filter(Boolean);
  return `${amount}${side}${limits.length ? ` (${limits.join(", ")})` : ""}`;
}

/** Plain-language restatement of what a rule will charge. */
function describeRule(rule: CommissionRule): string {
  const scope =
    rule.asset_type || rule.market ? ` · ${[rule.asset_type, rule.market].filter(Boolean).join(" / ")} only` : "";
  if (rule.components && rule.components.length > 0) {
    return rule.components.map((c) => `${c.label}: ${describeLine(c)}`).join(" · ") + scope;
  }
  const side =
    rule.applies_to === "both" ? " on entry and on exit" : rule.applies_to === "entry" ? " on entry only" : " on exit only";
  return (
    describeLine({ basis: rule.rule_type, amount: rule.amount, side: "both", min_fee: rule.min_fee, max_fee: rule.max_fee, max_percent: null }) +
    side +
    scope
  );
}

export function CommissionManager({ initialRules }: { initialRules: CommissionRule[] }) {
  const router = useRouter();
  const [rules, setRules] = useState(initialRules);
  const fieldId = useId();
  const [form, setForm] = useState<RuleForm>(BLANK);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<RuleForm>(BLANK);
  const [error, setError] = useState<string | null>(null);
  const [recalcState, setRecalcState] = useState<"idle" | "running" | "done">("idle");
  const [recalcMessage, setRecalcMessage] = useState<string | null>(null);

  const byCategory = useMemo(() => {
    const groups = new Map<PresetCategory, typeof BROKER_PRESETS>();
    for (const p of BROKER_PRESETS) groups.set(p.category, [...(groups.get(p.category) ?? []), p]);
    return groups;
  }, []);
  const chosenPreset = findPreset(form.preset_id);

  function applyTemplate(value: string) {
    const preset = findPreset(value);
    if (preset) {
      setForm({
        name: `${preset.broker} — ${preset.plan}`.slice(0, 80),
        asset_type: preset.asset_type ?? "",
        market: "",
        lines: preset.components.map(lineFromComponent),
        preset_id: preset.id,
      });
      return;
    }
    const template = CUSTOM_TEMPLATES.find((t) => t.id === value);
    if (template) setForm({ ...BLANK, name: "", lines: template.components.map(lineFromComponent) });
    else setForm(BLANK);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setAdding(true);
    setError(null);

    const res = await fetch("/api/commission-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toPayload(form, true)),
    });
    setAdding(false);

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Could not save the rule");
      return;
    }
    const created = (await res.json()) as CommissionRule;
    setRules((prev) => [...prev, created]);
    setForm(BLANK);
    router.refresh();
  }

  async function handleSaveEdit(id: string) {
    setError(null);
    const existing = rules.find((r) => r.id === id);
    const res = await fetch(`/api/commission-rules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toPayload(editForm, existing?.enabled ?? true)),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Could not save the rule");
      return;
    }
    const updated = (await res.json()) as CommissionRule;
    setRules((prev) => prev.map((r) => (r.id === id ? updated : r)));
    setEditingId(null);
    router.refresh();
  }

  async function handleToggle(rule: CommissionRule) {
    setError(null);
    try {
      const res = await fetch(`/api/commission-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      if (!res.ok) throw new Error();
      const updated = (await res.json()) as CommissionRule;
      setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
      router.refresh();
    } catch {
      setError(`Could not ${rule.enabled ? "disable" : "enable"} "${rule.name}". Try again.`);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this commission rule? Trades keep the commission already recorded on them.")) return;
    setError(null);
    try {
      const res = await fetch(`/api/commission-rules/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setRules((prev) => prev.filter((r) => r.id !== id));
      router.refresh();
    } catch {
      setError("Could not delete the rule. Try again.");
    }
  }

  async function handleRecalculate() {
    if (
      !confirm(
        "Recalculate every trade's P/L against the current rules?\n\nThis rewrites past results, so your dashboard, win rate, and account balance will change. Trades with a hand-entered commission are left alone.",
      )
    ) {
      return;
    }
    setRecalcState("running");
    setRecalcMessage(null);
    const res = await fetch("/api/commission-rules/recalculate", { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as {
      updated?: number;
      skipped?: number;
      failed?: number;
      error?: string;
    };
    setRecalcState("done");
    if (!res.ok) {
      setRecalcMessage(body.error ?? "Recalculation failed");
      return;
    }
    const parts = [`${body.updated ?? 0} trade${body.updated === 1 ? "" : "s"} recalculated`];
    if (body.skipped) parts.push(`${body.skipped} skipped (hand-entered)`);
    if (body.failed) parts.push(`${body.failed} failed`);
    setRecalcMessage(parts.join(" · "));
    router.refresh();
  }

  // `fields` renders twice -- once for the create form, once for whichever
  // rule is being edited -- so every id carries a per-instance prefix.
  const fields = (state: RuleForm, set: (next: RuleForm) => void, idPrefix: string) => {
    const setLine = (i: number, patch: Partial<LineForm>) =>
      set({ ...state, lines: state.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
    return (
      <>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <label className={labelClass} htmlFor={`${idPrefix}-name`}>Name</label>
            <input
              id={`${idPrefix}-name`}
              className={inputClass}
              placeholder="e.g. Stocks — $2.50 a side"
              value={state.name}
              onChange={(e) => set({ ...state, name: e.target.value })}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor={`${idPrefix}-asset`}>Asset type (blank = any)</label>
            <input
              id={`${idPrefix}-asset`}
              className={inputClass}
              placeholder="e.g. Option"
              value={state.asset_type}
              onChange={(e) => set({ ...state, asset_type: e.target.value })}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor={`${idPrefix}-market`}>Market (blank = any)</label>
            <input
              id={`${idPrefix}-market`}
              className={inputClass}
              placeholder="e.g. NASDAQ"
              value={state.market}
              onChange={(e) => set({ ...state, market: e.target.value })}
            />
          </div>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className={labelClass}>Fees charged</legend>
          {state.lines.length === 0 && (
            <p className="text-sm text-zinc-500">No fees: trades matching this rule are recorded commission-free.</p>
          )}
          {state.lines.map((line, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-zinc-200 p-3 dark:border-subtle sm:grid-cols-[1.2fr_1.2fr_0.8fr_1fr_auto]">
              <input
                aria-label="Fee name"
                className={`${inputClass} col-span-2 sm:col-span-1`}
                value={line.label}
                onChange={(e) => setLine(i, { label: e.target.value })}
              />
              <select
                aria-label="Charge type"
                className={inputClass}
                value={line.basis}
                onChange={(e) => setLine(i, { basis: e.target.value as CommissionRuleType })}
              >
                {(Object.keys(RULE_TYPE_LABELS) as CommissionRuleType[]).map((key) => (
                  <option key={key} value={key}>
                    {RULE_TYPE_LABELS[key]}
                  </option>
                ))}
              </select>
              <input
                aria-label={line.basis === "percent" ? "Percent" : "Amount ($)"}
                className={inputClass}
                type="number"
                step="any"
                min="0"
                placeholder={line.basis === "percent" ? "% e.g. 0.1" : "$ e.g. 2.50"}
                value={line.amount}
                onChange={(e) => setLine(i, { amount: e.target.value })}
              />
              <select
                aria-label="Charged on"
                className={inputClass}
                value={line.side}
                onChange={(e) => setLine(i, { side: e.target.value as FeeSide })}
              >
                {(Object.keys(FEE_SIDE_LABELS) as FeeSide[]).map((key) => (
                  <option key={key} value={key}>
                    {FEE_SIDE_LABELS[key]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                title="Remove this fee line"
                onClick={() => set({ ...state, lines: state.lines.filter((_, j) => j !== i) })}
                className="flex h-9 w-9 items-center justify-center justify-self-end rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-loss dark:hover:bg-zinc-800"
              >
                <X className="h-4 w-4" />
              </button>
              <details className="col-span-2 sm:col-span-5">
                <summary className="cursor-pointer text-xs text-zinc-500">
                  Minimum / maximum
                  {/* Say what's set, so a preset's $1 minimum isn't hidden. */}
                  {[
                    line.min_fee.trim() && `min $${line.min_fee}`,
                    line.max_fee.trim() && `max $${line.max_fee}`,
                    line.max_percent.trim() && `max ${line.max_percent}% of value`,
                  ]
                    .filter(Boolean)
                    .map((s) => ` · ${s}`)
                    .join("")}
                </summary>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <input aria-label="Minimum per side ($)" placeholder="Min $" className={inputClass} type="number" step="any" min="0" value={line.min_fee} onChange={(e) => setLine(i, { min_fee: e.target.value })} />
                  <input aria-label="Maximum per side ($)" placeholder="Max $" className={inputClass} type="number" step="any" min="0" value={line.max_fee} onChange={(e) => setLine(i, { max_fee: e.target.value })} />
                  <input aria-label="Maximum as % of trade value" placeholder="Max % of value" className={inputClass} type="number" step="any" min="0" value={line.max_percent} onChange={(e) => setLine(i, { max_percent: e.target.value })} />
                </div>
              </details>
            </div>
          ))}
          {state.lines.length < 8 && (
            <button
              type="button"
              onClick={() => set({ ...state, lines: [...state.lines, { ...BLANK_LINE, label: state.lines.length ? "Fee" : "Commission" }] })}
              className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              <Plus className="h-3.5 w-3.5" /> Add a fee line
            </button>
          )}
        </fieldset>
      </>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <FormError className="rounded-lg border border-loss/30 bg-loss/5 px-3 py-2">{error}</FormError>

      <div className="rounded-xl border border-zinc-200 dark:border-subtle bg-white dark:bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">Your rules</h2>
        {rules.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No rules yet. Add one below and new trades will have its fees applied automatically.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-subtle">
            {rules.map((rule) => {
              const preset = findPreset(rule.preset_id);
              return (
                <li key={rule.id} className="py-3 first:pt-0 last:pb-0">
                  {editingId === rule.id ? (
                    <div className="flex flex-col gap-3">
                      {fields(editForm, setEditForm, `${fieldId}-edit-${rule.id}`)}
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => handleSaveEdit(rule.id)}
                          className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-white dark:text-zinc-950 hover:brightness-110"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="rounded-full border border-zinc-300 dark:border-zinc-700 px-4 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:border-zinc-500"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-sm font-medium ${rule.enabled ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400 line-through"}`}
                        >
                          {rule.name}
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-500">{describeRule(rule)}</p>
                        {preset && (
                          <a
                            href={preset.source}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-primary"
                          >
                            {preset.broker} pricing, checked {CHECKED_ON} <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => handleToggle(rule)}
                          className="rounded-lg px-2.5 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                        >
                          {rule.enabled ? "Disable" : "Enable"}
                        </button>
                        <button
                          onClick={() => {
                            setEditingId(rule.id);
                            setEditForm(toForm(rule));
                          }}
                          title="Edit rule"
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(rule.id)}
                          title="Delete rule"
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-loss dark:hover:bg-zinc-800"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {rules.length > 1 && (
          <p className="mt-3 text-xs text-zinc-500">
            When more than one rule could apply, the first one in this list wins, so keep specific rules above
            catch-all ones.
          </p>
        )}
      </div>

      <form
        onSubmit={handleAdd}
        className="flex flex-col gap-3 rounded-xl border border-zinc-200 dark:border-subtle bg-white dark:bg-card p-4"
      >
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Add a rule</h2>

        <div>
          <label className={labelClass} htmlFor={`${fieldId}-preset`}>
            Start from your broker ({BROKER_PRESETS.length} researched) or a template
          </label>
          <select
            id={`${fieldId}-preset`}
            className={inputClass}
            value={form.preset_id ?? ""}
            onChange={(e) => applyTemplate(e.target.value)}
          >
            <option value="">Start from scratch</option>
            {[...byCategory.entries()].map(([category, presets]) => (
              <optgroup key={category} label={PRESET_CATEGORY_LABELS[category]}>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.broker} — {p.plan}
                  </option>
                ))}
              </optgroup>
            ))}
            <optgroup label="Templates (fill in your own numbers)">
              {CUSTOM_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </optgroup>
          </select>
          {chosenPreset ? (
            <p className="mt-1.5 text-xs text-zinc-500">
              {chosenPreset.note ? `${chosenPreset.note} ` : ""}Checked on {CHECKED_ON} —{" "}
              <a href={chosenPreset.source} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                {chosenPreset.broker}&apos;s pricing
              </a>
              . Brokers change prices, so check it matches your account before saving.
            </p>
          ) : (
            <p className="mt-1.5 text-xs text-zinc-500">
              Israeli bank or a broker that isn&apos;t listed? Pick “% of trade value with a minimum” and enter your
              broker&apos;s numbers.
            </p>
          )}
        </div>

        {fields(form, setForm, `${fieldId}-new`)}
        <button
          type="submit"
          data-tour-id="commissions-add"
          disabled={adding || !form.name.trim()}
          className="w-fit rounded-full bg-primary px-5 py-2 text-sm font-medium text-white dark:text-zinc-950 hover:brightness-110 disabled:opacity-50"
        >
          {adding ? "Adding..." : "Add rule"}
        </button>
      </form>

      <div className="rounded-xl border border-zinc-200 dark:border-subtle bg-white dark:bg-card p-4">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Existing trades</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Rules apply to trades as you create or edit them. Trades logged before you set these rules up keep their
          original P/L until you recalculate.
        </p>
        <button
          onClick={handleRecalculate}
          disabled={recalcState === "running"}
          className="mt-3 inline-flex items-center gap-2 rounded-full border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:border-zinc-500 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${recalcState === "running" ? "animate-spin" : ""}`} />
          {recalcState === "running" ? "Recalculating..." : "Recalculate all trades"}
        </button>
        {recalcMessage && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{recalcMessage}</p>}
      </div>
    </div>
  );
}
