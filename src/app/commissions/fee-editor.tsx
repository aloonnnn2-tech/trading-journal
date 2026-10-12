"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Plus, X } from "lucide-react";
import type { CommissionRuleType, FeeSide } from "@/lib/commissions/types";
import { CHECKED_ON, findPreset } from "@/lib/commissions/presets";
import {
  BLANK_CHARGE,
  CURRENCIES,
  CURRENCY_SYMBOL,
  ORDER_TYPES,
  ORDER_TYPE_LABELS,
  WHEN_LABELS,
  formatFee,
  isSplit,
  previewRule,
  splitForm,
  suggestName,
  tryIt,
  unsplitForm,
  type ChargeForm,
  type FeeForm,
} from "@/lib/commissions/fee-form";
import { FormError } from "@/components/form-error";

// "Create my own" -- and the same form for editing a fee or checking a
// broker preset before saving. Questions in a trader's words, a calculator
// beside them, and every less common option (size bands, conditions,
// currency) one "More options" away on each charge.

const input =
  "w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

const BASES: { id: CommissionRuleType; title: string; example: string; placeholder: string }[] = [
  { id: "flat", title: "A fixed amount", example: "e.g. $2.50 each time", placeholder: "2.50" },
  { id: "per_unit", title: "Per share or contract", example: "e.g. $0.005 a share", placeholder: "0.005" },
  { id: "percent", title: "A % of the trade", example: "e.g. 0.1% of the value", placeholder: "0.1" },
];

type WhenChoice = "both" | "split" | "entry" | "exit";
const WHEN_CHOICES: { id: WhenChoice; label: string }[] = [
  { id: "both", label: "The same when I buy and when I sell" },
  { id: "split", label: "Different when I buy and when I sell" },
  { id: "entry", label: "Only when I open a trade" },
  { id: "exit", label: "Only when I close a trade" },
];

const chip = (active: boolean) =>
  `rounded-lg border px-3 py-2 text-sm text-left ${
    active
      ? "border-primary bg-primary/10 text-zinc-900 dark:text-zinc-50"
      : "border-zinc-300 text-zinc-600 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-300"
  }`;

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
  // A template or blank form starts with its name already filled in.
  const [form, setFormRaw] = useState<FeeForm>(() =>
    initial.nameTouched || initial.name ? initial : { ...initial, name: suggestName(initial) },
  );
  const [shares, setShares] = useState("1");
  const [price, setPrice] = useState("80");
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [orderType, setOrderType] = useState("");

  // Functional updates throughout: a currency's rate arrives after a fetch,
  // and must land on the form as it is then, not as it was when asked for.
  // The name follows the answers until the user types one of their own.
  const update = (fn: (f: FeeForm) => FeeForm) =>
    setFormRaw((prev) => {
      const next = fn(prev);
      return next.nameTouched ? next : { ...next, name: suggestName(next) };
    });
  const setForm = (next: FeeForm) => update(() => next);
  const split = isSplit(form);
  const mainCount = form.charges.length === 0 ? 0 : split ? 2 : 1;
  const others = form.charges.slice(mainCount);
  const setCharge = (i: number, patch: Partial<ChargeForm>) =>
    update((f) => ({ ...f, charges: f.charges.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const when: WhenChoice = split ? "split" : form.charges[0]?.side === "entry" ? "entry" : form.charges[0]?.side === "exit" ? "exit" : "both";
  const chooseWhen = (w: WhenChoice) => setForm(w === "split" ? splitForm(form) : unsplitForm(form, w as FeeSide));

  const preset = findPreset(form.preset_id);
  const shareCount = Math.abs(Number(shares) || 0);
  const priceNum = Number(price) || 0;
  const calc = useMemo(
    () => tryIt(previewRule(form), shareCount, priceNum, { direction, orderType: orderType || null }),
    [form, shareCount, priceNum, direction, orderType],
  );
  // Fees "taken from the shares you buy" raise what each share effectively cost.
  const buyFromShares = form.charges.some((c) => c.taken_from === "shares");
  const effectiveBuy = shareCount > 0 ? priceNum + calc.buy / shareCount : null;

  const scopes = [...new Set([...assetTypes, ...(form.asset_type ? [form.asset_type] : [])])];

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
        <div className="flex flex-col gap-7 rounded-xl border border-zinc-200 bg-white p-4 dark:border-subtle dark:bg-card sm:p-6">
          {mainCount > 0 ? (
            <>
              <Question n={1} title="When is it charged?">
                <div className="grid gap-2 sm:grid-cols-2">
                  {WHEN_CHOICES.map((w) => (
                    <button key={w.id} type="button" aria-pressed={when === w.id} onClick={() => chooseWhen(w.id)} className={chip(when === w.id)}>
                      {w.label}
                    </button>
                  ))}
                </div>
              </Question>

              {split ? (
                <>
                  <Question n={2} title="When you buy">
                    <ChargeBlock charge={form.charges[0]} onChange={(p) => setCharge(0, p)} canTakeFromShares />
                  </Question>
                  <Question n={3} title="When you sell">
                    <ChargeBlock charge={form.charges[1]} onChange={(p) => setCharge(1, p)} />
                  </Question>
                </>
              ) : (
                <Question n={2} title="How much?">
                  <ChargeBlock
                    charge={form.charges[0]}
                    onChange={(p) => setCharge(0, p)}
                    canTakeFromShares={form.charges[0].side !== "exit"}
                  />
                </Question>
              )}
            </>
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              No commission: trades this covers are recorded fee-free.{" "}
              <button type="button" onClick={() => setForm({ ...form, charges: [BLANK_CHARGE, ...form.charges] })} className="text-primary hover:underline">
                Add a charge
              </button>
            </p>
          )}

          <Question n={mainCount === 2 ? 4 : mainCount === 1 ? 3 : 1} title="Which trades?">
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
                <input aria-label="Asset type" placeholder="Asset type, e.g. Option" className={input} value={form.asset_type} onChange={(e) => setForm({ ...form, asset_type: e.target.value })} />
                <input aria-label="Market" placeholder="Market, e.g. NASDAQ (blank = any)" className={input} value={form.market} onChange={(e) => setForm({ ...form, market: e.target.value })} />
              </div>
            </details>
          </Question>

          <Question n={mainCount === 2 ? 5 : mainCount === 1 ? 4 : 2} title="Name">
            <input
              aria-label="Name"
              className={input}
              value={form.name}
              maxLength={80}
              onChange={(e) => setFormRaw({ ...form, name: e.target.value, nameTouched: e.target.value.trim() !== "" })}
            />
            <p className="text-xs text-zinc-500">Filled in from your answers. Change it if you like.</p>
          </Question>

          {others.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-zinc-200 pt-5 dark:border-subtle">
              <div>
                <p className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">Other charges</p>
                <p className="text-xs text-zinc-500">On top of the fee above, like regulator or currency fees.</p>
              </div>
              {others.map((c, k) => (
                <div key={k} className="rounded-lg border border-zinc-200 p-3 dark:border-subtle sm:p-4">
                  <ChargeBlock
                    charge={c}
                    compact
                    onChange={(p) => setCharge(mainCount + k, p)}
                    onRemove={() => setForm({ ...form, charges: form.charges.filter((_, j) => j !== mainCount + k) })}
                  />
                </div>
              ))}
            </div>
          )}

          <FormError className="rounded-lg border border-loss/30 bg-loss/5 px-3 py-2">{error}</FormError>

          <div className="flex flex-col-reverse gap-3 border-t border-zinc-200 pt-5 dark:border-subtle sm:flex-row sm:items-center sm:justify-between">
            {form.charges.length < 8 ? (
              <button
                type="button"
                onClick={() => setForm({ ...form, charges: [...form.charges, { ...BLANK_CHARGE, label: "Other fee" }] })}
                className="inline-flex items-center gap-1.5 self-start text-sm text-primary hover:underline"
              >
                <Plus className="h-4 w-4" /> Add another charge (e.g. a currency or platform fee)
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
              {direction === "short" ? "Sold short at ($)" : "Bought at ($)"}
              <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className={`${input} font-mono`} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              Direction
              <select value={direction} onChange={(e) => setDirection(e.target.value as "long" | "short")} className={input}>
                <option value="long">Long</option>
                <option value="short">Short</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              Order type
              <select value={orderType} onChange={(e) => setOrderType(e.target.value)} className={input}>
                <option value="">Not set</option>
                {ORDER_TYPES.map((o) => (
                  <option key={o} value={o}>
                    {ORDER_TYPE_LABELS[o]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <dl className="flex flex-col gap-2 text-sm">
            <Row label="When you buy" value={formatFee(calc.buy)} />
            <Row label="When you sell" value={formatFee(calc.sell)} />
            <div className="border-t border-zinc-200 pt-2 dark:border-subtle">
              <Row label="Total" value={formatFee(calc.total)} bold />
            </div>
          </dl>
          {buyFromShares && direction === "long" && effectiveBuy != null && calc.buy > 0 && (
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              The buy fee comes out of your shares, so each share effectively cost{" "}
              <span className="font-mono text-zinc-900 dark:text-zinc-50">${effectiveBuy.toFixed(2)}</span>.
            </p>
          )}
          <div className="rounded-lg border border-primary/35 bg-primary/[0.07] p-3.5">
            <p className="text-xs text-zinc-500">Break-even price</p>
            <p className="mt-0.5 font-mono text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              {calc.breakeven == null ? "—" : `$${calc.breakeven.toFixed(2)}`}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              The price has to reach this before the trade makes money
              {calc.coverBuy != null && calc.entry > 0
                ? `. It covers the ${direction === "short" ? "opening" : "buy"} fee alone at $${calc.coverBuy.toFixed(2)}.`
                : "."}
            </p>
          </div>
          <p className="text-xs text-zinc-500">Closed at the same price it was opened at.</p>
        </aside>
      </div>
    </form>
  );
}

/**
 * One charge. Full: how it's charged, amount and currency, where it's taken
 * from, min/max, then "More options" (size bands, conditions). Compact
 * ("other charges"): a name, the essentials in a row, the rest under More.
 */
function ChargeBlock({
  charge,
  onChange,
  compact,
  onRemove,
  canTakeFromShares,
}: {
  charge: ChargeForm;
  onChange: (patch: Partial<ChargeForm>) => void;
  compact?: boolean;
  onRemove?: () => void;
  canTakeFromShares?: boolean;
}) {
  const [fxState, setFxState] = useState<"idle" | "loading" | "error">("idle");
  const moreCount =
    (charge.tiers.length > 0 ? 1 : 0) +
    (charge.cond_order_types.length > 0 || charge.cond_direction || charge.cond_price_below ? 1 : 0) +
    (compact && (charge.min_fee || charge.max_fee || charge.max_percent) ? 1 : 0);

  async function chooseCurrency(currency: string) {
    if (!currency) return onChange({ currency: "", fx_rate: "", fx_rate_date: "" });
    onChange({ currency });
    setFxState("loading");
    try {
      const res = await fetch(`/api/market-data/fx?from=${currency}`);
      const body = (await res.json()) as { rate?: number; date?: string };
      if (!res.ok || !body.rate) throw new Error();
      onChange({ currency, fx_rate: String(body.rate), fx_rate_date: body.date ?? "" });
      setFxState("idle");
    } catch {
      setFxState("error");
    }
  }

  const amountBox = (
    <span className="flex items-center rounded-lg border border-zinc-300 bg-zinc-50 focus-within:border-primary dark:border-zinc-700 dark:bg-zinc-950">
      {charge.basis !== "percent" && (
        <select
          aria-label="Currency"
          value={charge.currency}
          onChange={(e) => void chooseCurrency(e.target.value)}
          className="rounded-l-lg bg-transparent py-2 pl-2 pr-1 text-sm text-zinc-600 outline-none dark:text-zinc-300"
        >
          <option value="">$</option>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {CURRENCY_SYMBOL[c].trim()}
            </option>
          ))}
        </select>
      )}
      <input
        type="number"
        step="any"
        min="0"
        inputMode="decimal"
        aria-label={charge.basis === "percent" ? "Percent" : "Amount"}
        value={charge.amount}
        placeholder={BASES.find((b) => b.id === charge.basis)?.placeholder}
        onChange={(e) => onChange({ amount: e.target.value })}
        className="w-full min-w-0 bg-transparent px-2 py-2 font-mono text-sm text-zinc-900 outline-none dark:text-zinc-100"
      />
      {charge.basis === "percent" && <span className="pr-3 text-zinc-500">%</span>}
    </span>
  );

  const fxLine = charge.currency && charge.basis !== "percent" && (
    <label className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
      1 {CURRENCY_SYMBOL[charge.currency].trim()} =
      <span className="flex w-28 items-center rounded-lg border border-zinc-300 bg-zinc-50 px-2 dark:border-zinc-700 dark:bg-zinc-950">
        $
        <input
          type="number"
          step="any"
          min="0"
          aria-label="Exchange rate in dollars"
          value={charge.fx_rate}
          onChange={(e) => onChange({ fx_rate: e.target.value, fx_rate_date: "" })}
          className="w-full bg-transparent px-1 py-1.5 font-mono text-zinc-900 outline-none dark:text-zinc-100"
        />
      </span>
      {fxState === "loading"
        ? "fetching today's rate…"
        : fxState === "error"
          ? "couldn't fetch the rate — enter it yourself"
          : charge.fx_rate_date
            ? `today's rate (${charge.fx_rate_date}); saved with the fee, edit any time`
            : "your rate; saved with the fee"}
    </label>
  );

  const limits = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-zinc-600 dark:text-zinc-400">
        <label className="flex items-center gap-2">
          At least <Small value={charge.min_fee} onChange={(v) => onChange({ min_fee: v })} label="Minimum" prefix={CURRENCY_SYMBOL[charge.currency || "USD"]} />
        </label>
        <label className="flex items-center gap-2">
          At most <Small value={charge.max_fee} onChange={(v) => onChange({ max_fee: v })} label="Maximum" prefix={CURRENCY_SYMBOL[charge.currency || "USD"]} />
        </label>
        <label className="flex items-center gap-2">
          or at most <Small value={charge.max_percent} onChange={(v) => onChange({ max_percent: v })} label="Maximum as a percent of the trade" suffix="%" /> of the trade
        </label>
      </div>
      <p className="text-xs text-zinc-500">Optional, each time it&apos;s charged. Brokers like IBKR cap their fee at a % of the trade.</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {compact && (
        <div className="flex items-center gap-2">
          <input aria-label="Charge name" value={charge.label} onChange={(e) => onChange({ label: e.target.value })} className={`${input} font-medium`} />
          {onRemove && (
            <button type="button" aria-label={`Remove ${charge.label}`} onClick={onRemove} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-loss dark:hover:bg-zinc-800">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {compact ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <select aria-label="How it's charged" value={charge.basis} onChange={(e) => onChange({ basis: e.target.value as CommissionRuleType })} className={input}>
            {BASES.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
          {amountBox}
          <select aria-label="When it's charged" value={charge.side} onChange={(e) => onChange({ side: e.target.value as FeeSide })} className={`${input} col-span-2 sm:col-span-1`}>
            {(Object.keys(WHEN_LABELS) as FeeSide[]).map((w) => (
              <option key={w} value={w}>
                {WHEN_LABELS[w]}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            {BASES.map((b) => (
              <button
                key={b.id}
                type="button"
                aria-pressed={charge.basis === b.id}
                onClick={() => onChange({ basis: b.id })}
                className={`rounded-lg border p-3 text-left ${
                  charge.basis === b.id ? "border-primary bg-primary/10" : "border-zinc-300 hover:border-zinc-500 dark:border-zinc-700"
                }`}
              >
                <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50">{b.title}</span>
                <span className="mt-0.5 block text-xs text-zinc-500">{b.example}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300">
            <span className="min-w-32">
              {charge.basis === "percent" ? "Percent of the trade" : charge.basis === "per_unit" ? "Amount per share" : "Amount each time"}
            </span>
            <span className="w-44">{amountBox}</span>
          </div>
        </>
      )}
      {fxLine}

      {canTakeFromShares && !compact && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">Where does your broker take it from?</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={charge.taken_from === "cash"} onClick={() => onChange({ taken_from: "cash" })} className={chip(charge.taken_from === "cash")}>
              My cash balance
            </button>
            <button type="button" aria-pressed={charge.taken_from === "shares"} onClick={() => onChange({ taken_from: "shares" })} className={chip(charge.taken_from === "shares")}>
              The shares I buy
            </button>
          </div>
          {charge.taken_from === "shares" && (
            <p className="text-xs text-zinc-500">
              E.g. $2.50 on 1 share bought at $80: you effectively paid $82.50 for it. Your profit and loss comes out the same
              either way.
            </p>
          )}
        </div>
      )}

      {!compact && limits}

      <details className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-subtle" open={moreCount > 0 ? true : undefined}>
        <summary className="cursor-pointer text-sm text-zinc-600 dark:text-zinc-400">
          More options{moreCount > 0 ? ` · ${moreCount} set` : ""}{" "}
          <span className="text-xs text-zinc-500">
            {compact ? "(minimum/maximum, " : "("}changes with trade size, only on some trades)
          </span>
        </summary>
        <div className="mt-3 flex flex-col gap-5 pb-2">
          {compact && limits}
          <Tiers charge={charge} onChange={onChange} />
          <Conditions charge={charge} onChange={onChange} />
        </div>
      </details>
    </div>
  );
}

function Tiers({ charge, onChange }: { charge: ChargeForm; onChange: (patch: Partial<ChargeForm>) => void }) {
  const on = charge.tiers.length > 0;
  const setTier = (i: number, patch: Partial<ChargeForm["tiers"][number]>) =>
    onChange({ tiers: charge.tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const unit = charge.basis === "percent" ? "%" : CURRENCY_SYMBOL[charge.currency || "USD"];
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) =>
            onChange({
              tiers: e.target.checked
                ? [
                    { up_to: "10000", amount: charge.amount },
                    { up_to: "", amount: "" },
                  ]
                : [],
            })
          }
          className="h-4 w-4 accent-[var(--color-primary)]"
        />
        Changes with trade size
      </label>
      {on && (
        <div className="flex flex-col gap-2 pl-6">
          <label className="flex items-center gap-2 text-xs text-zinc-500">
            Size measured by
            <select value={charge.tier_by} onChange={(e) => onChange({ tier_by: e.target.value as "value" | "shares" })} className={`${input} w-auto py-1`}>
              <option value="value">the trade&apos;s value ($)</option>
              <option value="shares">the number of shares</option>
            </select>
          </label>
          {charge.tiers.map((t, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
              {i === charge.tiers.length - 1 && t.up_to === "" ? (
                <span className="w-40">Anything bigger</span>
              ) : (
                <span className="flex w-40 items-center gap-1">
                  Up to
                  <Small value={t.up_to} onChange={(v) => setTier(i, { up_to: v })} label="Up to" prefix={charge.tier_by === "value" ? "$" : undefined} suffix={charge.tier_by === "shares" ? "sh" : undefined} />
                </span>
              )}
              →
              <Small value={t.amount} onChange={(v) => setTier(i, { amount: v })} label="Amount for this size" prefix={unit === "%" ? undefined : unit} suffix={unit === "%" ? "%" : undefined} />
              {charge.tiers.length > 1 && (
                <button type="button" aria-label="Remove band" onClick={() => onChange({ tiers: charge.tiers.filter((_, j) => j !== i) })} className="text-zinc-400 hover:text-loss">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange({ tiers: [...charge.tiers.slice(0, -1), { up_to: "", amount: "" }, ...charge.tiers.slice(-1)] })}
            className="self-start text-xs text-primary hover:underline"
          >
            + Add a size band
          </button>
          <p className="text-xs text-zinc-500">The band a trade falls in sets its rate for the whole trade. Leave the last limit empty for &quot;anything bigger&quot;.</p>
        </div>
      )}
    </div>
  );
}

function Conditions({ charge, onChange }: { charge: ChargeForm; onChange: (patch: Partial<ChargeForm>) => void }) {
  const toggleOrder = (o: string) =>
    onChange({
      cond_order_types: charge.cond_order_types.includes(o) ? charge.cond_order_types.filter((x) => x !== o) : [...charge.cond_order_types, o],
    });
  const small = (active: boolean) =>
    `rounded-md border px-2.5 py-1 text-xs ${active ? "border-primary bg-primary/10 text-zinc-900 dark:text-zinc-50" : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"}`;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Only charge it on some trades</p>
      <div className="flex flex-col gap-1.5 pl-1">
        <span className="text-xs text-zinc-500">Order type (none picked = any)</span>
        <div className="flex flex-wrap gap-1.5">
          {ORDER_TYPES.map((o) => (
            <button key={o} type="button" aria-pressed={charge.cond_order_types.includes(o)} onClick={() => toggleOrder(o)} className={small(charge.cond_order_types.includes(o))}>
              {ORDER_TYPE_LABELS[o]}
            </button>
          ))}
        </div>
        {charge.cond_order_types.length > 0 && (
          <span className="text-[11px] text-zinc-500">Trades with no order type set won&apos;t be charged this.</span>
        )}
      </div>
      <div className="flex flex-col gap-1.5 pl-1">
        <span className="text-xs text-zinc-500">Direction</span>
        <div className="flex flex-wrap gap-1.5">
          {([
            ["", "Long and short"],
            ["long", "Long only"],
            ["short", "Short only"],
          ] as const).map(([v, l]) => (
            <button key={v} type="button" aria-pressed={charge.cond_direction === v} onClick={() => onChange({ cond_direction: v })} className={small(charge.cond_direction === v)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <label className="flex flex-wrap items-center gap-2 pl-1 text-xs text-zinc-500">
        Only when the price is under
        <Small value={charge.cond_price_below} onChange={(v) => onChange({ cond_price_below: v })} label="Price under" prefix="$" />
        <span>(e.g. $1 for cheap stocks)</span>
      </label>
    </div>
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

function Small({
  value,
  onChange,
  label,
  prefix,
  suffix,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <span className="flex w-28 items-center rounded-lg border border-zinc-300 bg-zinc-50 px-2 focus-within:border-primary dark:border-zinc-700 dark:bg-zinc-950">
      {prefix && <span className="text-zinc-500">{prefix.trim()}</span>}
      <input
        type="number"
        step="any"
        min="0"
        inputMode="decimal"
        aria-label={label}
        value={value}
        placeholder="none"
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-w-0 bg-transparent px-1 py-1.5 font-mono text-sm text-zinc-900 outline-none dark:text-zinc-100"
      />
      {suffix && <span className="text-zinc-500">{suffix}</span>}
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
