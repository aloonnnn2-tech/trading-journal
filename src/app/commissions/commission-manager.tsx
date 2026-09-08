"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Pencil, Trash2, RefreshCw } from "lucide-react";
import type { CommissionRule, CommissionRuleType, CommissionSide } from "@/lib/commissions/types";
import { RULE_TYPE_LABELS, SIDE_LABELS } from "@/lib/commissions/types";
import { FormError } from "@/components/form-error";

const inputClass =
  "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary";
const labelClass = "mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400";

interface RuleForm {
  name: string;
  rule_type: CommissionRuleType;
  amount: string;
  applies_to: CommissionSide;
  asset_type: string;
  market: string;
  min_fee: string;
  max_fee: string;
}

const BLANK: RuleForm = {
  name: "",
  rule_type: "flat",
  amount: "",
  applies_to: "both",
  asset_type: "",
  market: "",
  min_fee: "",
  max_fee: "",
};

function toForm(rule: CommissionRule): RuleForm {
  return {
    name: rule.name,
    rule_type: rule.rule_type,
    amount: String(rule.amount),
    applies_to: rule.applies_to,
    asset_type: rule.asset_type ?? "",
    market: rule.market ?? "",
    min_fee: rule.min_fee == null ? "" : String(rule.min_fee),
    max_fee: rule.max_fee == null ? "" : String(rule.max_fee),
  };
}

function toPayload(form: RuleForm, enabled: boolean) {
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  return {
    name: form.name.trim(),
    rule_type: form.rule_type,
    amount: Number(form.amount || 0),
    applies_to: form.applies_to,
    asset_type: form.asset_type.trim() || null,
    market: form.market.trim() || null,
    min_fee: num(form.min_fee),
    max_fee: num(form.max_fee),
    enabled,
  };
}

/** Plain-language restatement of what a rule will charge, so the effect is
 *  legible without having to mentally run the calculation. */
function describeRule(rule: CommissionRule): string {
  const amount =
    rule.rule_type === "percent"
      ? `${rule.amount}% of trade value`
      : rule.rule_type === "per_unit"
        ? `$${rule.amount} per share`
        : `$${rule.amount}`;
  const side =
    rule.applies_to === "both"
      ? "on entry and on exit"
      : rule.applies_to === "entry"
        ? "on entry only"
        : "on exit only";
  const scope =
    rule.asset_type || rule.market
      ? ` · ${[rule.asset_type, rule.market].filter(Boolean).join(" / ")} only`
      : "";
  const clamp =
    rule.min_fee != null || rule.max_fee != null
      ? ` · ${rule.min_fee != null ? `min $${rule.min_fee}` : ""}${rule.min_fee != null && rule.max_fee != null ? ", " : ""}${rule.max_fee != null ? `max $${rule.max_fee}` : ""}`
      : "";
  return `${amount} ${side}${scope}${clamp}`;
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
      // Was a silent return: the switch just didn't move, with no reason
      // given -- unlike every other handler on this page.
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
  // rule is being edited -- and both can be on the page at the same time, so
  // the ids tying each <label> to its control need a per-instance prefix.
  // Without it the two forms share ids and a label points at the other form's
  // input. These labels previously had no htmlFor and wrapped nothing, so
  // every field here was an unlabelled box to a screen reader.
  const fields = (state: RuleForm, set: (next: RuleForm) => void, idPrefix: string) => (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
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
          <label className={labelClass} htmlFor={`${idPrefix}-type`}>Charge type</label>
          <select
            id={`${idPrefix}-type`}
            className={inputClass}
            value={state.rule_type}
            onChange={(e) => set({ ...state, rule_type: e.target.value as CommissionRuleType })}
          >
            {(Object.keys(RULE_TYPE_LABELS) as CommissionRuleType[]).map((key) => (
              <option key={key} value={key}>
                {RULE_TYPE_LABELS[key]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`${idPrefix}-amount`}>
            {state.rule_type === "percent" ? "Percent (e.g. 0.1 for 0.1%)" : "Amount ($)"}
          </label>
          <input
            id={`${idPrefix}-amount`}
            className={inputClass}
            type="number"
            step="any"
            min="0"
            placeholder={state.rule_type === "percent" ? "0.1" : "2.50"}
            value={state.amount}
            onChange={(e) => set({ ...state, amount: e.target.value })}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor={`${idPrefix}-side`}>Charged on</label>
          <select
            id={`${idPrefix}-side`}
            className={inputClass}
            value={state.applies_to}
            onChange={(e) => set({ ...state, applies_to: e.target.value as CommissionSide })}
          >
            {(Object.keys(SIDE_LABELS) as CommissionSide[]).map((key) => (
              <option key={key} value={key}>
                {SIDE_LABELS[key]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <details className="rounded-lg border border-zinc-200 dark:border-subtle px-3 py-2">
        <summary className="cursor-pointer text-xs text-zinc-500">
          Limit to certain trades, or set a min/max fee
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor={`${idPrefix}-asset`}>Asset type (blank = any)</label>
            <input
              id={`${idPrefix}-asset`}
              className={inputClass}
              placeholder="e.g. crypto"
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
          <div>
            <label className={labelClass} htmlFor={`${idPrefix}-min`}>Minimum fee per side ($)</label>
            <input
              id={`${idPrefix}-min`}
              className={inputClass}
              type="number"
              step="any"
              min="0"
              value={state.min_fee}
              onChange={(e) => set({ ...state, min_fee: e.target.value })}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor={`${idPrefix}-max`}>Maximum fee per side ($)</label>
            <input
              id={`${idPrefix}-max`}
              className={inputClass}
              type="number"
              step="any"
              min="0"
              value={state.max_fee}
              onChange={(e) => set({ ...state, max_fee: e.target.value })}
            />
          </div>
        </div>
      </details>
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      <FormError className="rounded-lg border border-loss/30 bg-loss/5 px-3 py-2">
        {error}
      </FormError>

      <div className="rounded-xl border border-zinc-200 dark:border-subtle bg-white dark:bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">Your rules</h2>
        {rules.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No rules yet. Add one below and new trades will have its fees applied automatically.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-subtle">
            {rules.map((rule) => (
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
                    <div className="min-w-0">
                      <p
                        className={`text-sm font-medium ${rule.enabled ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400 line-through"}`}
                      >
                        {rule.name}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">{describeRule(rule)}</p>
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
            ))}
          </ul>
        )}
        {rules.length > 1 && (
          <p className="mt-3 text-xs text-zinc-500">
            When more than one rule could apply, the first one in this list wins, so keep specific
            rules above catch-all ones.
          </p>
        )}
      </div>

      <form
        onSubmit={handleAdd}
        className="flex flex-col gap-3 rounded-xl border border-zinc-200 dark:border-subtle bg-white dark:bg-card p-4"
      >
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Add a rule</h2>
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
          Rules apply to trades as you create or edit them. Trades logged before you set these rules
          up keep their original P/L until you recalculate.
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
