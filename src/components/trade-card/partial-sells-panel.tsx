"use client";

import { useId, useState } from "react";
import { Scissors } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/form-error";
import { InfoTip } from "@/components/ui/InfoTip";
import { sideFee } from "@/lib/commissions/calculate";
import type { CommissionRule } from "@/lib/commissions/types";
import { formatMoney } from "@/lib/format/money";
import {
  PARTIAL_EXIT_REASONS,
  partialExitReasonLabel,
  salePl,
  summarizePartialExits,
} from "@/lib/trades/partial-exits";
import type { PartialExit, PartialExitReason, Trade } from "@/lib/trades/types";

const inputClass =
  "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary";
const labelClass = "mb-1 block text-xs font-medium text-zinc-500";
const smallButton =
  "rounded-lg border border-zinc-300 dark:border-zinc-700 px-2.5 py-1 text-xs text-zinc-700 dark:text-zinc-200 hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-40";

interface Draft {
  /** Set when changing an existing sale. */
  id: string | null;
  shares: string;
  price: string;
  date: string;
  reason: PartialExitReason;
  note: string;
  fee: string;
}

/**
 * Partial sells (0079): sell part of an open position -- before earnings, to
 * cut risk, to take some profit -- and keep the rest. Each sale is logged
 * through its own route (/api/trades/[id]/partial-exits), which checks it
 * against the trade, and the trade comes back with P&L and fees recomputed.
 * Selling everything that's left is not a sale but the normal close: exit
 * price, exit date, status closed.
 */
export function PartialSellsPanel({
  trade,
  commissionRule,
  livePrice,
  flushNow,
  onSaved,
  onCloseRest,
}: {
  trade: Trade;
  commissionRule: CommissionRule | null;
  /** The chart's latest price, to prefill the form. */
  livePrice: number | null;
  flushNow: () => Promise<void>;
  onSaved: (trade: Trade) => void;
  /** Sell everything that's left: closes the trade at this price and time. */
  onCloseRest: (price: number, date: string) => Promise<void>;
}) {
  const formId = useId();
  const summary = summarizePartialExits(trade);
  const short = trade.direction === "short";
  const verb = short ? "Buy back" : "Sell";
  const held = trade.shares != null ? Math.abs(trade.shares) : null;
  const remaining = summary.remainingShares;
  const canSell =
    trade.status === "open" && trade.entry_price != null && held != null && held > 0 && remaining != null && remaining > 0;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  if (summary.sales.length === 0 && trade.status !== "open") return null;

  // What's left to sell while editing a sale: its own shares are available again.
  const editingShares = draft?.id ? (summary.sales.find((s) => s.id === draft.id)?.shares ?? 0) : 0;
  const available = remaining != null ? round(remaining + editingShares) : null;

  function open(sale?: PartialExit) {
    setError(null);
    setConfirmingDelete(null);
    setDraft(
      sale
        ? {
            id: sale.id,
            shares: String(sale.shares),
            price: String(sale.price),
            date: toLocalInput(sale.date),
            reason: sale.reason,
            note: sale.note ?? "",
            fee: sale.fee != null ? String(sale.fee) : "",
          }
        : {
            id: null,
            shares: "",
            price: livePrice != null ? String(roundPrice(livePrice)) : "",
            date: toLocalInput(new Date().toISOString()),
            reason: "reduce_risk",
            note: "",
            fee: "",
          },
    );
  }

  const shares = draft ? Number(draft.shares) : NaN;
  const price = draft ? Number(draft.price) : NaN;
  const sellsAll = draft != null && draft.id == null && available != null && Number.isFinite(shares) && round(shares) >= available;
  const draftFee =
    draft && draft.fee.trim() !== ""
      ? Number(draft.fee)
      : commissionRule && Number.isFinite(shares) && Number.isFinite(price) && shares > 0 && price > 0
        ? sideFee(commissionRule, "exit", price, shares, trade.direction, trade.order_type)
        : null;
  const draftPl =
    trade.entry_price != null && Number.isFinite(shares) && Number.isFinite(price) && shares > 0 && price > 0
      ? salePl({ shares, price }, trade.entry_price, trade.direction) - (draftFee ?? 0)
      : null;

  async function send(method: "POST" | "PATCH" | "DELETE", body: unknown) {
    setSaving(true);
    setError(null);
    try {
      // Pending edits first, so the sale is checked against what's on screen.
      await flushNow();
      const res = await fetch(`/api/trades/${trade.id}/partial-exits`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as (Trade & { error?: string }) | null;
      if (!res.ok || !data) throw new Error(data?.error ?? "Couldn't save that. Try again.");
      onSaved(data);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that. Try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    if (!Number.isFinite(shares) || shares <= 0) return setError("Enter how many shares.");
    if (!Number.isFinite(price) || price <= 0) return setError("Enter the price.");
    if (!draft.date || Number.isNaN(new Date(draft.date).getTime())) return setError("Enter the date.");
    if (available != null && round(shares) > available) {
      return setError(`You hold ${fmtShares(available)} shares.`);
    }
    const fee = draft.fee.trim() === "" ? null : Number(draft.fee);
    if (fee != null && (!Number.isFinite(fee) || fee < 0)) return setError("The fee can't be negative.");
    const date = new Date(draft.date).toISOString();

    if (sellsAll) {
      setSaving(true);
      setError(null);
      try {
        await onCloseRest(price, date);
        setDraft(null);
      } catch {
        setError("Couldn't close the trade. Try again.");
      } finally {
        setSaving(false);
      }
      return;
    }

    const sale = { date, shares, price, reason: draft.reason, note: draft.note.trim() || null, fee };
    const ok = draft.id ? await send("PATCH", { id: draft.id, sale }) : await send("POST", { sale });
    if (ok) setDraft(null);
  }

  return (
    <Card standalone={false} hoverable={false}>
      <section aria-labelledby={`${formId}-title`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2
          id={`${formId}-title`}
          className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400"
        >
          Partial sells
          <InfoTip
            text={`${short ? "Bought back" : "Sold"} part of the position and kept the rest. Each sale counts in this trade's P&L, and the exit price is for the shares left at the end.`}
          />
        </h2>
        {canSell && !draft && (
          <button
            type="button"
            onClick={() => open()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:border-zinc-500"
          >
            <Scissors className="h-3.5 w-3.5" strokeWidth={2} />
            {verb} part
          </button>
        )}
      </div>

      {summary.sales.length > 0 ? (
        <p className="mb-3 text-sm text-zinc-700 dark:text-zinc-300">
          {short ? "Bought back" : "Sold"} {fmtShares(summary.soldShares)} of {held != null ? fmtShares(held) : "?"}
          {remaining != null && <> · {fmtShares(remaining)} {trade.status === "closed" ? "closed at the exit price" : "still held"}</>}
          {summary.realizedGross != null && (
            <>
              {" "}· Realized by the sales{" "}
              <span className={summary.realizedGross >= 0 ? "text-profit" : "text-loss"}>
                {formatMoney(summary.realizedGross, { sign: "always" })}
              </span>{" "}
              before fees
            </>
          )}
        </p>
      ) : (
        !draft && (
          <p className="text-sm text-zinc-500">
            {canSell
              ? `Took some off before earnings, or to cut risk? ${verb} part and keep the rest.`
              : "Add the entry price and number of shares to log a partial sale."}
          </p>
        )
      )}

      {held != null && summary.soldShares >= held && (
        <p className="mb-3 text-sm text-loss">
          The sales add up to {fmtShares(summary.soldShares)} shares, but the trade has {fmtShares(held)}. Raise the number of shares or remove a sale.
        </p>
      )}

      {summary.sales.length > 0 && (
        <ul className="mb-3 divide-y divide-zinc-200 dark:divide-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-800">
          {summary.sales.map((sale) => {
            const fee =
              sale.fee ?? (commissionRule ? sideFee(commissionRule, "exit", sale.price, sale.shares, trade.direction, trade.order_type) : null);
            const pl = trade.entry_price != null ? salePl(sale, trade.entry_price, trade.direction) - (fee ?? 0) : null;
            return (
              <li key={sale.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-sm">
                  <div className="text-zinc-900 dark:text-zinc-100">
                    {fmtShares(sale.shares)} at {formatMoney(sale.price)}
                    <span className="text-zinc-500"> · {formatDate(sale.date)}</span>
                  </div>
                  <div className="text-xs text-zinc-500">
                    {partialExitReasonLabel(sale.reason)}
                    {sale.note ? <span className="break-words"> · {sale.note}</span> : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {pl != null && (
                    <span
                      className={`text-sm tabular-nums ${pl >= 0 ? "text-profit" : "text-loss"}`}
                      title={fee != null && fee > 0 ? `After a ${formatMoney(fee)} fee` : "No fee"}
                    >
                      {formatMoney(pl, { sign: "always" })}
                    </span>
                  )}
                  {confirmingDelete === sale.id ? (
                    <span className="flex items-center gap-1.5 text-xs">
                      Remove?
                      <button
                        type="button"
                        disabled={saving}
                        className={`${smallButton} border-loss/40 text-loss`}
                        onClick={async () => {
                          if (await send("DELETE", { id: sale.id })) setConfirmingDelete(null);
                        }}
                      >
                        Yes
                      </button>
                      <button type="button" className={smallButton} onClick={() => setConfirmingDelete(null)}>
                        No
                      </button>
                    </span>
                  ) : (
                    <>
                      <button type="button" className={smallButton} disabled={saving} onClick={() => open(sale)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className={smallButton}
                        disabled={saving}
                        onClick={() => {
                          setDraft(null);
                          setConfirmingDelete(sale.id);
                        }}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {draft && (
        <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div>
              <label className={labelClass} htmlFor={`${formId}-shares`}>
                Shares{available != null ? ` (of ${fmtShares(available)})` : ""}
              </label>
              <input
                id={`${formId}-shares`}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                className={inputClass}
                value={draft.shares}
                onChange={(e) => setDraft({ ...draft, shares: e.target.value })}
              />
              {available != null && draft.id == null && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {[0.25, 0.5, 0.75].map((part) => {
                    const n = portion(available, part);
                    return (
                      <button
                        key={part}
                        type="button"
                        className={smallButton}
                        disabled={n <= 0}
                        onClick={() => setDraft({ ...draft, shares: String(n) })}
                      >
                        {part * 100}%
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className={smallButton}
                    onClick={() => setDraft({ ...draft, shares: String(available) })}
                  >
                    All
                  </button>
                </div>
              )}
            </div>
            <div>
              <label className={labelClass} htmlFor={`${formId}-price`}>
                Price
              </label>
              <input
                id={`${formId}-price`}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                className={inputClass}
                value={draft.price}
                onChange={(e) => setDraft({ ...draft, price: e.target.value })}
              />
              {livePrice != null && draft.id == null && (
                <p className="mt-1.5 text-xs text-zinc-500">Filled in from the chart&apos;s last price.</p>
              )}
            </div>
            <div className="col-span-2">
              <label className={labelClass} htmlFor={`${formId}-date`}>
                When
              </label>
              <input
                id={`${formId}-date`}
                type="datetime-local"
                className={inputClass}
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              />
            </div>
          </div>

          {!sellsAll && (
            <>
              <fieldset>
                <legend className={labelClass}>Why</legend>
                <div className="flex flex-wrap gap-1.5">
                  {PARTIAL_EXIT_REASONS.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      aria-pressed={draft.reason === r.value}
                      onClick={() => setDraft({ ...draft, reason: r.value })}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        draft.reason === r.value
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-zinc-500"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_10rem]">
                <div>
                  <label className={labelClass} htmlFor={`${formId}-note`}>
                    Note (optional)
                  </label>
                  <input
                    id={`${formId}-note`}
                    type="text"
                    maxLength={500}
                    className={inputClass}
                    placeholder="e.g. earnings Thursday after the close"
                    value={draft.note}
                    onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor={`${formId}-fee`}>
                    Fee
                  </label>
                  <input
                    id={`${formId}-fee`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    className={inputClass}
                    placeholder={commissionRule ? "From your fee rule" : "None"}
                    value={draft.fee}
                    onChange={(e) => setDraft({ ...draft, fee: e.target.value })}
                  />
                </div>
              </div>
            </>
          )}

          {sellsAll ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              That&apos;s everything you hold, so this closes the trade at {Number.isFinite(price) && price > 0 ? formatMoney(price) : "this price"}.
            </p>
          ) : (
            draftPl != null && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                This sale:{" "}
                <span className={draftPl >= 0 ? "text-profit" : "text-loss"}>{formatMoney(draftPl, { sign: "always" })}</span>
                {draftFee != null && draftFee > 0 ? ` after a ${formatMoney(draftFee)} fee` : ""}
                {available != null && Number.isFinite(shares) && shares > 0 && shares < available
                  ? ` · ${fmtShares(round(available - shares))} left`
                  : ""}
              </p>
            )
          )}

          <FormError>{error}</FormError>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50 dark:text-zinc-950"
            >
              {saving ? "Saving…" : sellsAll ? `${verb} all and close` : draft.id ? "Save changes" : short ? "Log buy-back" : "Log sale"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3.5 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:border-zinc-500"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {!draft && <FormError>{error}</FormError>}
      </section>
    </Card>
  );
}

function round(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

// Whole shares when the position is whole; otherwise four decimals.
function portion(available: number, part: number): number {
  return Number.isInteger(available) ? Math.floor(available * part) : Math.floor(available * part * 1e4) / 1e4;
}

function roundPrice(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmtShares(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString() : String(round(n));
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
