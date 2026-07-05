"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const inputClass =
  "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary";
const labelClass = "mb-1 block text-xs font-medium text-zinc-500";

export function AddTradeButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    const res = await fetch("/api/trades", { method: "POST" });
    const trade = await res.json();
    router.push(`/trades/${trade.id}`);
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:border-zinc-500 disabled:opacity-50"
    >
      {loading ? "Creating..." : "+ Add trade"}
    </button>
  );
}

export function QuickTradeButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ticker, setTicker] = useState("");
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [status, setStatus] = useState<"pending" | "open" | "closed">("open");
  const [entryPrice, setEntryPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [shares, setShares] = useState("");
  const [dollarAmount, setDollarAmount] = useState("");

  function reset() {
    setTicker("");
    setDirection("long");
    setStatus("open");
    setEntryPrice("");
    setStopLoss("");
    setTakeProfit("");
    setShares("");
    setDollarAmount("");
  }

  // Shares, dollar amount, and entry price are linked (amount = shares × price).
  // Editing any one of them recalculates whichever of the other two is derivable.
  function handleEntryPriceChange(value: string) {
    setEntryPrice(value);
    const price = Number(value);
    if (value === "" || Number.isNaN(price) || price === 0) return;
    if (shares !== "" && !Number.isNaN(Number(shares))) {
      setDollarAmount((Number(shares) * price).toFixed(2));
    } else if (dollarAmount !== "" && !Number.isNaN(Number(dollarAmount))) {
      setShares((Number(dollarAmount) / price).toFixed(4));
    }
  }

  function handleSharesChange(value: string) {
    setShares(value);
    const sharesNum = Number(value);
    const price = Number(entryPrice);
    if (value === "" || Number.isNaN(sharesNum) || entryPrice === "" || Number.isNaN(price)) return;
    setDollarAmount((sharesNum * price).toFixed(2));
  }

  function handleDollarAmountChange(value: string) {
    setDollarAmount(value);
    const amount = Number(value);
    const price = Number(entryPrice);
    if (value === "" || Number.isNaN(amount) || entryPrice === "" || Number.isNaN(price) || price === 0) return;
    setShares((amount / price).toFixed(4));
  }

  async function handleCreate(skipDetails: boolean) {
    setSubmitting(true);
    const res = await fetch("/api/trades", { method: "POST" });
    const trade = await res.json();

    if (!skipDetails && (ticker || entryPrice || stopLoss || takeProfit || shares || dollarAmount)) {
      await fetch(`/api/trades/${trade.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          core: {
            ticker,
            direction,
            status,
            entry_price: entryPrice === "" ? null : Number(entryPrice),
            stop_loss: stopLoss === "" ? null : Number(stopLoss),
            take_profit: takeProfit === "" ? null : Number(takeProfit),
            shares: shares === "" ? null : Number(shares),
            dollar_amount: dollarAmount === "" ? null : Number(dollarAmount),
          },
        }),
      });
    }

    setSubmitting(false);
    setOpen(false);
    reset();
    router.push(`/trades/${trade.id}`);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white dark:text-zinc-950 shadow-[0_1px_2px_rgba(28,27,24,0.2)] hover:brightness-110"
      >
        Quick trade
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => !submitting && setOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="w-full max-w-sm rounded-2xl border border-zinc-200 dark:border-subtle bg-white dark:bg-card p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Quick Trade</h2>

              <div className="flex flex-col gap-3">
                <div>
                  <label className={labelClass}>Ticker</label>
                  <input
                    type="text"
                    autoFocus
                    placeholder="e.g. AAPL"
                    className={inputClass}
                    value={ticker}
                    onChange={(e) => setTicker(e.target.value.toUpperCase())}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Direction</label>
                    <select
                      className={inputClass}
                      value={direction}
                      onChange={(e) => setDirection(e.target.value as "long" | "short")}
                    >
                      <option value="long">Long</option>
                      <option value="short">Short</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Status</label>
                    <select
                      className={inputClass}
                      value={status}
                      onChange={(e) => setStatus(e.target.value as "pending" | "open" | "closed")}
                    >
                      <option value="pending">Pending</option>
                      <option value="open">Open</option>
                      <option value="closed">Closed</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Entry Price</label>
                    <input
                      type="number"
                      step="any"
                      placeholder="0.00"
                      className={inputClass}
                      value={entryPrice}
                      onChange={(e) => handleEntryPriceChange(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Number of Shares</label>
                    <input
                      type="number"
                      step="any"
                      placeholder="0"
                      className={inputClass}
                      value={shares}
                      onChange={(e) => handleSharesChange(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Dollar Amount</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="0.00"
                    className={inputClass}
                    value={dollarAmount}
                    onChange={(e) => handleDollarAmountChange(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Stop Loss</label>
                    <input
                      type="number"
                      step="any"
                      placeholder="0.00"
                      className={inputClass}
                      value={stopLoss}
                      onChange={(e) => setStopLoss(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Take Profit</label>
                    <input
                      type="number"
                      step="any"
                      placeholder="0.00"
                      className={inputClass}
                      value={takeProfit}
                      onChange={(e) => setTakeProfit(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <p className="mt-3 text-xs text-zinc-500">
                All fields are optional — you can fill in notes, emotions, and everything else on the next screen.
              </p>

              <div className="mt-5 flex items-center justify-between">
                <button
                  onClick={() => handleCreate(true)}
                  disabled={submitting}
                  className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-50"
                >
                  Skip, add blank
                </button>
                <button
                  onClick={() => handleCreate(false)}
                  disabled={submitting}
                  className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white dark:text-zinc-950 hover:brightness-110 disabled:opacity-50"
                >
                  {submitting ? "Creating..." : "Create trade"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
