"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import type { CommissionRule } from "@/lib/commissions/types";
import type { BrokerPreset } from "@/lib/commissions/presets";
import { BLANK_FORM, formFromComponents, formFromRule, payloadFromForm, type FeeForm } from "@/lib/commissions/fee-form";
import { FormError } from "@/components/form-error";
import { FeeList } from "./fee-list";
import { AddFees } from "./add-fees";
import { FeeEditor } from "./fee-editor";
import { MonthlyCosts } from "./monthly-costs";
import type { MonthlyCost } from "@/lib/monthly-costs/due";

// Setup -> Commissions, rebuilt around three screens (Alon approved the
// sketch, 2026-09-29): your fees in plain words -> add fees (your broker, or
// your own) -> a five-question form with a live calculator. Same rules, same
// API and calculation as before; only the page changed.

type View =
  | { kind: "list" }
  | { kind: "add" }
  | { kind: "form"; editing: CommissionRule | null; initial: FeeForm; title: string };

export function CommissionManager({
  initialRules,
  assetTypes,
  monthlyCosts,
  takenCounts,
}: {
  initialRules: CommissionRule[];
  assetTypes: string[];
  monthlyCosts: MonthlyCost[] | null;
  takenCounts: Record<string, number>;
}) {
  const router = useRouter();
  const [rules, setRules] = useState(initialRules);
  const [view, setViewRaw] = useState<View>({ kind: "list" });
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [recalc, setRecalc] = useState<"idle" | "running">("idle");
  const [recalcMessage, setRecalcMessage] = useState<string | null>(null);

  // Each screen starts at the top: they replace one another in place.
  const setView = (v: View) => {
    setViewRaw(v);
    setFormError(null);
    window.scrollTo({ top: 0 });
  };

  async function save(form: FeeForm) {
    if (view.kind !== "form") return;
    setSaving(true);
    setFormError(null);
    const editing = view.editing;
    const res = await fetch(editing ? `/api/commission-rules/${editing.id}` : "/api/commission-rules", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadFromForm(form, editing?.enabled ?? true)),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
      setFormError(body?.error ?? "Couldn't save the fee. Try again.");
      return;
    }
    const saved = (await res.json()) as CommissionRule;
    setRules((prev) => (editing ? prev.map((r) => (r.id === saved.id ? saved : r)) : [...prev, saved]));
    setView({ kind: "list" });
    router.refresh();
  }

  async function patch(rule: CommissionRule, body: Record<string, unknown>): Promise<CommissionRule | null> {
    const res = await fetch(`/api/commission-rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    return res?.ok ? ((await res.json()) as CommissionRule) : null;
  }

  async function toggle(rule: CommissionRule) {
    setError(null);
    setBusyId(rule.id);
    const updated = await patch(rule, { enabled: !rule.enabled });
    setBusyId(null);
    if (!updated) return setError(`Couldn't turn "${rule.name}" ${rule.enabled ? "off" : "on"}. Try again.`);
    setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
    router.refresh();
  }

  async function remove(rule: CommissionRule) {
    if (!confirm(`Delete "${rule.name}"? Trades keep the fees already recorded on them.`)) return;
    setError(null);
    setBusyId(rule.id);
    const res = await fetch(`/api/commission-rules/${rule.id}`, { method: "DELETE" }).catch(() => null);
    setBusyId(null);
    if (!res?.ok) return setError("Couldn't delete the fee. Try again.");
    setRules((prev) => prev.filter((r) => r.id !== rule.id));
    router.refresh();
  }

  // Which fee wins is list order (sort_order). Moving one renumbers the list
  // 0..n-1 and saves only the rows whose number changed.
  async function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    [next[index], next[target]] = [next[target], next[index]];
    const before = rules;
    setRules(next);
    setError(null);
    const changed = next.map((r, i) => ({ r, i })).filter(({ r, i }) => r.sort_order !== i);
    setBusyId(next[target].id);
    const results = await Promise.all(changed.map(({ r, i }) => patch(r, { sort_order: i })));
    setBusyId(null);
    if (results.some((r) => !r)) {
      setRules(before);
      return setError("Couldn't change the order. Try again.");
    }
    setRules(next.map((r, i) => ({ ...r, sort_order: i })));
    router.refresh();
  }

  async function recalculate() {
    if (
      !confirm(
        "Apply your current fees to every trade you've logged?\n\nThis rewrites past results, so your dashboard, win rate and account balance will change. Trades where you typed the commission yourself are left alone.",
      )
    ) {
      return;
    }
    setRecalc("running");
    setRecalcMessage(null);
    const res = await fetch("/api/commission-rules/recalculate", { method: "POST" }).catch(() => null);
    const body = ((await res?.json().catch(() => ({}))) ?? {}) as { updated?: number; skipped?: number; failed?: number; error?: string };
    setRecalc("idle");
    if (!res?.ok) return setRecalcMessage(body.error ?? "Couldn't update your trades. Try again.");
    const parts = [`${body.updated ?? 0} trade${body.updated === 1 ? "" : "s"} updated`];
    if (body.skipped) parts.push(`${body.skipped} left as you typed them`);
    if (body.failed) parts.push(`${body.failed} failed`);
    setRecalcMessage(parts.join(" · "));
    router.refresh();
  }

  if (view.kind === "add") {
    return (
      <AddFees
        onCancel={() => setView({ kind: "list" })}
        onCreateOwn={() => setView({ kind: "form", editing: null, initial: BLANK_FORM, title: "Create my own fee" })}
        onPickTemplate={(tpl) =>
          setView({ kind: "form", editing: null, initial: formFromComponents(tpl.components), title: "Create my own fee" })
        }
        onPickPreset={(p: BrokerPreset) =>
          setView({
            kind: "form",
            editing: null,
            title: `${p.broker} — ${p.plan}`,
            initial: formFromComponents(p.components, {
              name: `${p.broker} — ${p.plan}`.slice(0, 80),
              asset_type: p.asset_type ?? "",
              preset_id: p.id,
            }),
          })
        }
      />
    );
  }

  if (view.kind === "form") {
    return (
      <FeeEditor
        key={view.editing?.id ?? view.initial.preset_id ?? "new"}
        initial={view.initial}
        title={view.title}
        assetTypes={assetTypes}
        saving={saving}
        error={formError}
        onSave={save}
        onCancel={() => setView(view.editing ? { kind: "list" } : { kind: "add" })}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">Your fees</h2>
        <button
          type="button"
          data-tour-id="commissions-add"
          onClick={() => setView({ kind: "add" })}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110 dark:text-zinc-950"
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} /> Add fees
        </button>
      </div>

      <FormError className="rounded-lg border border-loss/30 bg-loss/5 px-3 py-2">{error}</FormError>

      <FeeList
        rules={rules}
        busyId={busyId}
        onToggle={toggle}
        onDelete={remove}
        onMove={move}
        onEdit={(rule) => setView({ kind: "form", editing: rule, initial: formFromRule(rule), title: `Edit "${rule.name}"` })}
      />

      <MonthlyCosts initial={monthlyCosts} takenCounts={takenCounts} />

      <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-subtle dark:bg-card sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <p className="font-semibold text-zinc-900 dark:text-zinc-50">Trades you logged before</p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Changing fees only affects new and edited trades. Apply them to your older trades too?
          </p>
          {recalcMessage && <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{recalcMessage}</p>}
        </div>
        <button
          type="button"
          onClick={recalculate}
          disabled={recalc === "running"}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-800 hover:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-100"
        >
          <RefreshCw className={`h-4 w-4 ${recalc === "running" ? "animate-spin" : ""}`} />
          {recalc === "running" ? "Updating…" : "Update old trades"}
        </button>
      </div>
    </div>
  );
}
