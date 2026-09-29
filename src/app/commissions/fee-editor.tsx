"use client";

import { useId, useMemo, useState } from "react";
import { ExternalLink, Plus, X } from "lucide-react";
import type { CommissionRuleType, FeeSide } from "@/lib/commissions/types";
import { CHECKED_ON, findPreset } from "@/lib/commissions/presets";
import {
  BLANK_CHARGE,
  MAIN_WHEN,
  WHEN_LABELS,
  formatFee,
  previewRule,
  suggestName,
  tryIt,
  type ChargeForm,
  type FeeForm,
} from "@/lib/commissions/fee-form";
import { FormError } from "@/components/form-error";

// "Create my own" -- and the same form for editing a fee or checking a
// broker preset before saving. Five questions in a trader's words, with a
// calculator beside them that updates as they're answered.

const input =
  "w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

const BASES: { id: CommissionRuleType; title: string; example: string; placeholder: string }[] = [
  { id: "flat", title: "A fixed amount", example: "e.g. $2.50 each trade", placeholder: "2.50" },
  { id: "per_unit", title: "Per share or contract", example: "e.g. $0.005 a share", placeholder: "0.005" },
  { id: "percent", title: "A % of the trade", example: "e.g. 0.1% of the value", placeholder: "0.1" },
];

export function FeeEditor({
  initial,
  title,
  assetTypes,
  saving,
  error,
  onSave,
  onCancel,
}: {
  initial: FeeForm;
  title: string;
  /** Asset types from the user's own trades, offered as "Which trades?" choices. */
  assetTypes: string[];
  saving: boolean;
  error: string | null;
  onSave: (form: FeeForm) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [form, setFormRaw] = useState<FeeForm>(initial);
  const [shares, setShares] = useState("1");
  const [price, setPrice] = useState("80");

  // The name follows the answers until the user types one of their own.
  const setForm = (next: FeeForm) => setFormRaw(next.nameTouched ? next : { ...next, name: suggestName(next) });
  const main = form.charges[0];
  const others = form.charges.slice(1);
  const setCharge = (i: number, patch: Partial<ChargeForm>) =>
    setForm({ ...form, charges: form.charges.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  const preset = findPreset(form.preset_id);
  const calc = useMemo(
    () => tryIt(previewRule(form), Math.abs(Number(shares) || 0), Number(price) || 0),
    [form, shares, price],
  );

  const scopes = [...new Set([...assetTypes, ...(form.asset_type ? [form.asset_type] : [])])];
  const chip = (active: boolean) =>
    `rounded-lg border px-3 py-2 text-sm ${
      active
        ? "border-primary bg-primary/10 text-zinc-900 dark:text-zinc-50"
        : "border-zinc-300 text-zinc-600 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-300"
    }`;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(form);
      }}
      className="flex flex-col gap-5"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{title}</h2>
        <button type="button" onClick={onCancel} className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          Cancel
        </button>
      </div>

      {preset && (
        <p className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300">
          Filled in from {preset.broker}&apos;s published prices, checked on {CHECKED_ON}.{" "}
          {preset.note ? `${preset.note} ` : ""}
          <a href={preset.source} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            Their pricing <ExternalLink className="h-3 w-3" />
          </a>
          . Check it matches your account before saving.
        </p>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6 rounded-xl border border-zinc-200 bg-white p-4 dark:border-subtle dark:bg-card sm:p-6">
          {main ? (
            <>
              <Question n={1} title="How does your broker charge?">
                <div className="grid gap-2 sm:grid-cols-3">
                  {BASES.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      aria-pressed={main.basis === b.id}
                      onClick={() => setCharge(0, { basis: b.id })}
                      className={`rounded-lg border p-3 text-left ${
                        main.basis === b.id
                          ? "border-primary bg-primary/10"
                          : "border-zinc-300 hover:border-zinc-500 dark:border-zinc-700"
                      }`}
                    >
                      <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50">{b.title}</span>
                      <span className="mt-0.5 block text-xs text-zinc-500">{b.example}</span>
                    </button>
                  ))}
                </div>
                <label className="mt-1 flex flex-wrap items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300">
                  <span className="min-w-36">
                    {main.basis === "percent" ? "Percent of the trade" : main.basis === "per_unit" ? "Amount per share" : "Amount per trade"}
                  </span>
                  <Money
                    value={main.amount}
                    onChange={(v) => setCharge(0, { amount: v })}
                    percent={main.basis === "percent"}
                    placeholder={BASES.find((b) => b.id === main.basis)?.placeholder}
                    label="Amount"
                  />
                </label>
              </Question>

              <Question n={2} title="When is it charged?">
                <div className="flex flex-wrap gap-2">
                  {(MAIN_WHEN.includes(main.side) ? MAIN_WHEN : [...MAIN_WHEN, main.side]).map((w) => (
                    <button key={w} type="button" aria-pressed={main.side === w} onClick={() => setCharge(0, { side: w })} className={chip(main.side === w)}>
                      {WHEN_LABELS[w]}
                    </button>
                  ))}
                </div>
              </Question>

              <Question n={3} title="A minimum or maximum?" hint="Optional">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm text-zinc-600 dark:text-zinc-400">
                  <label className="flex items-center gap-2">
                    At least <Money value={main.min_fee} onChange={(v) => setCharge(0, { min_fee: v })} placeholder="none" label="Minimum per trade" small />
                  </label>
                  <label className="flex items-center gap-2">
                    At most <Money value={main.max_fee} onChange={(v) => setCharge(0, { max_fee: v })} placeholder="none" label="Maximum per trade" small />
                  </label>
                  <label className="flex items-center gap-2">
                    or at most <Money value={main.max_percent} onChange={(v) => setCharge(0, { max_percent: v })} placeholder="none" label="Maximum as a percent of the trade" percent small /> of the trade
                  </label>
                </div>
                <p className="text-xs text-zinc-500">Per buy or sell. Brokers like IBKR cap their fee at a % of the trade.</p>
              </Question>
            </>
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              No commission: trades this covers are recorded fee-free.{" "}
              <button type="button" onClick={() => setForm({ ...form, charges: [BLANK_CHARGE] })} className="text-primary hover:underline">
                Add a charge
              </button>
            </p>
          )}

          <Question n={main ? 4 : 1} title="Which trades?">
            <div className="flex flex-wrap gap-2">
              <button type="button" aria-pressed={!form.asset_type} onClick={() => setForm({ ...form, asset_type: "" })} className={chip(!form.asset_type)}>
                All my trades
              </button>
              {scopes.map((a) => (
                <button key={a} type="button" aria-pressed={form.asset_type === a} onClick={() => setForm({ ...form, asset_type: a })} className={chip(form.asset_type === a)}>
                  {a} only
                </button>
              ))}
            </div>
            <details className="text-xs text-zinc-500">
              <summary className="cursor-pointer">A type or market that isn&apos;t listed</summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <input
                  aria-label="Asset type"
                  placeholder="Asset type, e.g. Option"
                  className={input}
                  value={form.asset_type}
                  onChange={(e) => setForm({ ...form, asset_type: e.target.value })}
                />
                <input
                  aria-label="Market"
                  placeholder="Market, e.g. NASDAQ (blank = any)"
                  className={input}
                  value={form.market}
                  onChange={(e) => setForm({ ...form, market: e.target.value })}
                />
              </div>
            </details>
            {scopes.length === 0 && <p className="text-xs text-zinc-500">Once your trades have an asset type, they&apos;ll be offered here.</p>}
          </Question>

          <Question n={main ? 5 : 2} title="Name">
            <input
              id={`${id}-name`}
              aria-label="Name"
              className={input}
              value={form.name}
              maxLength={80}
              onChange={(e) => setFormRaw({ ...form, name: e.target.value, nameTouched: e.target.value.trim() !== "" })}
            />
            <p className="text-xs text-zinc-500">Filled in from your answers. Change it if you like.</p>
          </Question>

          {others.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-zinc-200 pt-5 dark:border-subtle">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Other charges</p>
              <p className="text-xs text-zinc-500">Charged on top of the commission above, like regulator or currency fees.</p>
              {others.map((c, k) => (
                <OtherCharge key={k} charge={c} onChange={(patch) => setCharge(k + 1, patch)} onRemove={() => setForm({ ...form, charges: form.charges.filter((_, j) => j !== k + 1) })} />
              ))}
            </div>
          )}

          <FormError className="rounded-lg border border-loss/30 bg-loss/5 px-3 py-2">{error}</FormError>

          <div className="flex flex-col-reverse gap-3 border-t border-zinc-200 pt-5 dark:border-subtle sm:flex-row sm:items-center sm:justify-between">
            {form.charges.length < 8 && main ? (
              <button
                type="button"
                onClick={() => setForm({ ...form, charges: [...form.charges, { ...BLANK_CHARGE, label: "Other fee" }] })}
                className="inline-flex items-center gap-1.5 self-start text-sm text-primary hover:underline"
              >
                <Plus className="h-4 w-4" /> Add another charge (e.g. a currency fee)
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2.5 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50 dark:text-zinc-950 sm:flex-none"
              >
                {saving ? "Saving…" : "Save fee"}
              </button>
            </div>
          </div>

          {/* Phones: the Try-it card lands below the whole form, so its two
              key figures ride along above the tab bar while you answer. */}
          <div className="sticky bottom-[calc(var(--tabbar-h)+0.5rem)] z-10 -mx-1 flex items-center justify-between gap-3 rounded-lg border border-primary/35 bg-white/95 px-3 py-2 text-xs backdrop-blur dark:bg-card/95 lg:hidden">
            <span className="text-zinc-500">
              {shares || 0} at ${price || 0}: <span className="font-mono text-zinc-900 dark:text-zinc-50">{formatFee(calc.total)}</span> in fees
            </span>
            <span className="text-zinc-500">
              Break-even{" "}
              <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-50">
                {calc.breakeven == null ? "—" : `$${calc.breakeven.toFixed(2)}`}
              </span>
            </span>
          </div>
        </div>

        <aside className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-subtle dark:bg-[var(--band-raised)] sm:p-6 lg:sticky lg:top-20">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">Try it</p>
            <p className="mt-0.5 text-sm text-zinc-500">Changes as you edit the fee.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              Shares
              <input value={shares} onChange={(e) => setShares(e.target.value)} inputMode="decimal" className={`${input} font-mono`} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              Bought at ($)
              <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className={`${input} font-mono`} />
            </label>
          </div>
          <dl className="flex flex-col gap-2 text-sm">
            <Row label="When you buy" value={formatFee(calc.buy)} />
            <Row label="When you sell" value={formatFee(calc.sell)} />
            <div className="border-t border-zinc-200 pt-2 dark:border-subtle">
              <Row label="Total" value={formatFee(calc.total)} bold />
            </div>
          </dl>
          <div className="rounded-lg border border-primary/35 bg-primary/[0.07] p-3.5">
            <p className="text-xs text-zinc-500">Break-even price</p>
            <p className="mt-0.5 font-mono text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              {calc.breakeven == null ? "—" : `$${calc.breakeven.toFixed(2)}`}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              The price has to reach this before the trade makes money
              {calc.coverBuy != null && calc.buy > 0 ? `. It covers the buy fee alone at $${calc.coverBuy.toFixed(2)}.` : "."}
            </p>
          </div>
          <p className="text-xs text-zinc-500">For a long trade sold at the price you bought it.</p>
        </aside>
      </div>
    </form>
  );
}

function Question({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">
        {n}. {title} {hint && <span className="font-normal text-zinc-500">{hint}</span>}
      </legend>
      {children}
    </fieldset>
  );
}

function Money({
  value,
  onChange,
  percent,
  placeholder,
  label,
  small,
}: {
  value: string;
  onChange: (v: string) => void;
  percent?: boolean;
  placeholder?: string;
  label: string;
  small?: boolean;
}) {
  return (
    <span
      className={`flex items-center rounded-lg border border-zinc-300 bg-zinc-50 px-2.5 focus-within:border-primary dark:border-zinc-700 dark:bg-zinc-950 ${
        small ? "w-28" : "w-40"
      }`}
    >
      {!percent && <span className="text-zinc-500">$</span>}
      <input
        type="number"
        step="any"
        min="0"
        inputMode="decimal"
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-w-0 bg-transparent px-1.5 py-2 font-mono text-sm text-zinc-900 outline-none dark:text-zinc-100"
      />
      {percent && <span className="text-zinc-500">%</span>}
    </span>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${bold ? "font-semibold text-zinc-900 dark:text-zinc-50" : ""}`}>
      <dt className={bold ? "" : "text-zinc-600 dark:text-zinc-400"}>{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}

function OtherCharge({
  charge,
  onChange,
  onRemove,
}: {
  charge: ChargeForm;
  onChange: (patch: Partial<ChargeForm>) => void;
  onRemove: () => void;
}) {
  return (
    // Two rows: the name, then how / how much / when -- one row squeezed a
    // rate like $0.000195 down to "0.000".
    <div className="grid grid-cols-2 gap-2 rounded-lg border border-zinc-200 p-3 dark:border-subtle sm:grid-cols-3">
      <div className="col-span-2 flex items-center gap-2 sm:col-span-3">
      <input aria-label="Charge name" value={charge.label} onChange={(e) => onChange({ label: e.target.value })} className={`${input} font-medium`} />
      <button type="button" aria-label={`Remove ${charge.label}`} onClick={onRemove} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-loss dark:hover:bg-zinc-800">
        <X className="h-4 w-4" />
      </button>
      </div>
      <select aria-label="How it's charged" value={charge.basis} onChange={(e) => onChange({ basis: e.target.value as CommissionRuleType })} className={input}>
        {BASES.map((b) => (
          <option key={b.id} value={b.id}>
            {b.title}
          </option>
        ))}
      </select>
      <input
        aria-label={charge.basis === "percent" ? "Percent" : "Amount ($)"}
        type="number"
        step="any"
        min="0"
        value={charge.amount}
        placeholder={charge.basis === "percent" ? "%" : "$"}
        onChange={(e) => onChange({ amount: e.target.value })}
        className={`${input} font-mono`}
      />
      <select aria-label="When it's charged" value={charge.side} onChange={(e) => onChange({ side: e.target.value as FeeSide })} className={input}>
        {(Object.keys(WHEN_LABELS) as FeeSide[]).map((w) => (
          <option key={w} value={w}>
            {WHEN_LABELS[w]}
          </option>
        ))}
      </select>
      {(charge.max_fee || charge.min_fee) && (
        <p className="col-span-2 text-xs text-zinc-500 sm:col-span-3">
          {charge.min_fee && `At least $${charge.min_fee}. `}
          {charge.max_fee && `At most $${charge.max_fee} per trade.`}
        </p>
      )}
    </div>
  );
}
