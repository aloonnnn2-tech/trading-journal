"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { costInAccountCurrency, nextDue, type MonthlyCost } from "@/lib/monthly-costs/due";
import { CURRENCIES, CURRENCY_SYMBOL, formatFee } from "@/lib/commissions/fee-form";
import { Switch } from "@/components/ui/Switch";
import { FormError } from "@/components/form-error";

// Monthly costs: platform, data or account fees charged per month, not per
// trade. Each month one comes due it is taken from cash as a withdrawal
// (Alon's choice, 2026-09-29), so the balance reflects it.

const input =
  "w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

const today = () => new Date().toISOString().slice(0, 10);

interface Draft {
  name: string;
  amount: string;
  currency: string;
  fx_rate: string;
  day_of_month: string;
  starts_on: string;
}

const BLANK: Draft = { name: "", amount: "", currency: "", fx_rate: "", day_of_month: "1", starts_on: "" };

export function MonthlyCosts({ initial, takenCounts }: { initial: MonthlyCost[] | null; takenCounts: Record<string, number> }) {
  const router = useRouter();
  const [costs, setCosts] = useState(initial ?? []);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>({ ...BLANK, starts_on: today() });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fxNote, setFxNote] = useState<string | null>(null);

  if (initial === null) {
    return (
      <Section>
        <p className="text-sm text-zinc-500">
          Monthly costs will be available shortly (a database update, migration 0057, is pending).
        </p>
      </Section>
    );
  }

  async function chooseCurrency(currency: string) {
    setDraft((d) => ({ ...d, currency, fx_rate: "" }));
    setFxNote(null);
    if (!currency) return;
    setFxNote("Fetching today's rate…");
    try {
      const res = await fetch(`/api/market-data/fx?from=${currency}`);
      const body = (await res.json()) as { rate?: number; date?: string };
      if (!res.ok || !body.rate) throw new Error();
      setDraft((d) => (d.currency === currency ? { ...d, fx_rate: String(body.rate) } : d));
      setFxNote(`Today's rate (${body.date}). Saved with the cost; edit it any time.`);
    } catch {
      setFxNote("Couldn't fetch today's rate. Enter it yourself.");
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch("/api/monthly-costs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draft.name.trim(),
        amount: Number(draft.amount),
        currency: draft.currency || null,
        fx_rate: draft.currency ? Number(draft.fx_rate) || null : null,
        day_of_month: Number(draft.day_of_month),
        starts_on: draft.starts_on || today(),
        active: true,
      }),
    }).catch(() => null);
    setSaving(false);
    const body = (await res?.json().catch(() => null)) as { cost?: MonthlyCost; taken?: number; error?: string } | null;
    if (!res?.ok || !body?.cost) return setError(body?.error ?? "Couldn't save it. Try again.");
    setCosts((c) => [...c, body.cost!]);
    setDraft({ ...BLANK, starts_on: today() });
    setAdding(false);
    setFxNote(null);
    router.refresh();
  }

  async function toggle(cost: MonthlyCost) {
    const res = await fetch(`/api/monthly-costs/${cost.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !cost.active }),
    }).catch(() => null);
    if (!res?.ok) return setError("Couldn't change it. Try again.");
    const updated = (await res.json()) as MonthlyCost;
    setCosts((c) => c.map((x) => (x.id === cost.id ? updated : x)));
  }

  async function remove(cost: MonthlyCost) {
    if (!confirm(`Delete "${cost.name}"? It won't be taken again. Months already taken stay in your cash history.`)) return;
    const res = await fetch(`/api/monthly-costs/${cost.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return setError("Couldn't delete it. Try again.");
    setCosts((c) => c.filter((x) => x.id !== cost.id));
  }

  const symbol = CURRENCY_SYMBOL[draft.currency || "USD"].trim();

  return (
    <Section
      action={
        !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-800 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-100"
          >
            <Plus className="h-4 w-4" /> Add a monthly cost
          </button>
        )
      }
    >
      {costs.length === 0 && !adding && (
        <p className="text-sm text-zinc-500">
          Platform, market-data or account fees you pay every month. Each one is taken from your cash on its day, so your
          balance stays true.
        </p>
      )}

      {costs.length > 0 && (
        <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800/70">
          {costs.map((c) => {
            const next = nextDue(c, today());
            const taken = takenCounts[c.id] ?? 0;
            return (
              <li key={c.id} className={`flex items-center justify-between gap-4 py-3 ${c.active ? "" : "opacity-60"}`}>
                <div className="min-w-0">
                  <p className="font-medium text-zinc-900 dark:text-zinc-50">{c.name}</p>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {formatFee(Number(c.amount), c.currency ?? "USD")} on day {c.day_of_month} of every month
                    {c.currency ? ` (≈ ${formatFee(costInAccountCurrency(c))})` : ""}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {c.active ? (next ? `Next taken from your cash on ${next}` : "") : "Paused"}
                    {taken > 0 ? ` · taken ${taken} time${taken === 1 ? "" : "s"} so far` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Switch checked={c.active} onChange={() => void toggle(c)} labelledBy={`mc-${c.id}`} />
                  <span id={`mc-${c.id}`} className="sr-only">
                    {c.name} on
                  </span>
                  <button type="button" onClick={() => void remove(c)} className="text-sm text-loss hover:underline">
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <FormError className="rounded-lg border border-loss/30 bg-loss/5 px-3 py-2">{error}</FormError>

      {adding && (
        <form onSubmit={add} className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-subtle">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              What is it?
              <input required maxLength={80} className={input} placeholder="e.g. Market data subscription" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              How much each month?
              <span className="flex items-center rounded-lg border border-zinc-300 bg-zinc-50 focus-within:border-primary dark:border-zinc-700 dark:bg-zinc-950">
                <select aria-label="Currency" value={draft.currency} onChange={(e) => void chooseCurrency(e.target.value)} className="bg-transparent py-2 pl-2 pr-1 text-sm text-zinc-600 outline-none dark:text-zinc-300">
                  <option value="">$</option>
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {CURRENCY_SYMBOL[c].trim()}
                    </option>
                  ))}
                </select>
                <input
                  required
                  type="number"
                  step="any"
                  min="0.01"
                  inputMode="decimal"
                  aria-label="Amount"
                  value={draft.amount}
                  placeholder="29.00"
                  onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                  className="w-full bg-transparent px-2 py-2 font-mono text-sm text-zinc-900 outline-none dark:text-zinc-100"
                />
              </span>
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              Taken on day
              <select className={input} value={draft.day_of_month} onChange={(e) => setDraft({ ...draft, day_of_month: e.target.value })}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              Starting
              <input type="date" className={input} value={draft.starts_on} onChange={(e) => setDraft({ ...draft, starts_on: e.target.value })} />
            </label>
          </div>
          {draft.currency && (
            <label className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              1 {symbol} =
              <span className="flex w-28 items-center rounded-lg border border-zinc-300 bg-zinc-50 px-2 dark:border-zinc-700 dark:bg-zinc-950">
                $
                <input
                  required
                  type="number"
                  step="any"
                  min="0"
                  aria-label="Exchange rate in dollars"
                  value={draft.fx_rate}
                  onChange={(e) => setDraft({ ...draft, fx_rate: e.target.value })}
                  className="w-full bg-transparent px-1 py-1.5 font-mono text-zinc-900 outline-none dark:text-zinc-100"
                />
              </span>
              {fxNote}
            </label>
          )}
          <p className="text-xs text-zinc-500">
            It&apos;s taken from your cash as a withdrawal on that day each month. A start date in the past takes the months
            already due (up to 12).
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="rounded-lg px-4 py-2 text-sm text-zinc-600 dark:text-zinc-400">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:text-zinc-950">
              {saving ? "Saving…" : "Add monthly cost"}
            </button>
          </div>
        </form>
      )}
    </Section>
  );
}

function Section({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">Monthly costs</h2>
        {action}
      </div>
      <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-subtle dark:bg-card sm:p-5">
        {children}
      </div>
    </section>
  );
}
