"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Landmark, Minus, Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { InfoTip } from "@/components/ui/InfoTip";
import type { AccountBalance, AccountTransaction } from "@/lib/account/queries";

// compact drops the cents once the amount reaches four figures -- the card
// is narrow (six-up grid on desktop) and "$11,234.56" no longer fits.
function formatMoney(value: number, compact = false): string {
  const abs = Math.abs(value);
  const decimals = compact && abs >= 1000 ? 0 : 2;
  return `${value < 0 ? "−" : ""}$${abs.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

type PanelMode = "deposit" | "withdraw";

// Interactive sibling of StatCard: shows current account cash (deposits
// minus withdrawals plus realized trade P/L) and lets the user add or
// remove money in place. Trade wins/losses are never written to the
// ledger -- they flow in through the derived balance, so the number here
// updates on its own as trades close.
export function AccountCashCard({
  initialBalance,
  initialTransactions,
}: {
  initialBalance: AccountBalance;
  initialTransactions: AccountTransaction[];
}) {
  const router = useRouter();
  const [account, setAccount] = useState(initialBalance);
  const [transactions, setTransactions] = useState(initialTransactions);
  const [panel, setPanel] = useState<PanelMode | null>(null);
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openPanel(mode: PanelMode) {
    setPanel(panel === mode ? null : mode);
    setAmount("");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Enter an amount above 0.");
      return;
    }

    setSaving(true);
    setError(null);
    const signed = panel === "withdraw" ? -parsed : parsed;
    const res = await fetch("/api/account/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: signed }),
    });
    setSaving(false);

    if (!res.ok) {
      setError("Could not save. Try again.");
      return;
    }

    const data = (await res.json()) as AccountBalance & { transaction: AccountTransaction };
    setAccount(data);
    setTransactions((prev) => [data.transaction, ...prev]);
    setAmount("");
    router.refresh();
  }

  async function handleDelete(id: string) {
    const previous = { account, transactions };
    setTransactions((prev) => prev.filter((t) => t.id !== id));

    const res = await fetch(`/api/account/transactions/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setAccount(previous.account);
      setTransactions(previous.transactions);
      return;
    }
    const data = (await res.json()) as AccountBalance;
    setAccount(data);
    router.refresh();
  }

  const hint = account.hasTransactions
    ? `${formatMoney(account.availableCash, true)} available`
    : "Set your starting cash";

  return (
    <div className="relative">
      <Card className="p-4" standalone={false} hoverable={false}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
              Account Cash
              <InfoTip text="Total cash: money you've added or removed, plus every closed trade's win or loss — updated automatically. Available: total cash minus what's tied up in open positions. New trades pre-fill their position size from what's available." />
            </p>
            <p className="tnum mt-1.5 truncate text-[22px] font-semibold leading-tight tracking-tight text-zinc-900 dark:text-zinc-50">
              {account.hasTransactions ? formatMoney(account.balance, true) : "—"}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Landmark className="h-4 w-4" strokeWidth={2} />
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => openPanel("deposit")}
                title="Add money"
                className={`flex h-6 w-6 items-center justify-center rounded-md border text-profit transition-colors ${
                  panel === "deposit"
                    ? "border-profit/50 bg-profit/10"
                    : "border-zinc-200 hover:border-profit/50 dark:border-subtle"
                }`}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
              </button>
              <button
                onClick={() => openPanel("withdraw")}
                title="Remove money"
                className={`flex h-6 w-6 items-center justify-center rounded-md border text-loss transition-colors ${
                  panel === "withdraw"
                    ? "border-loss/50 bg-loss/10"
                    : "border-zinc-200 hover:border-loss/50 dark:border-subtle"
                }`}
              >
                <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </div>
      </Card>

      {panel !== null && (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-lg dark:border-subtle dark:bg-card">
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">
              {panel === "deposit"
                ? account.hasTransactions
                  ? "Add money"
                  : "Set starting cash"
                : "Remove money"}
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                step="any"
                min="0"
                autoFocus
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="tnum w-full min-w-0 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 font-mono text-sm text-zinc-900 outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
              <button
                type="submit"
                disabled={saving}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 ${
                  panel === "withdraw" ? "bg-loss hover:bg-loss/90" : "bg-profit hover:bg-profit/90"
                }`}
              >
                {panel === "withdraw" ? "Remove" : "Add"}
              </button>
            </div>
            {error && <p className="text-xs text-loss">{error}</p>}
          </form>

          {transactions.length > 0 && (
            <ul className="mt-3 flex max-h-40 flex-col overflow-y-auto border-t border-zinc-100 pt-2 dark:border-subtle">
              {transactions.map((tx) => (
                <li
                  key={tx.id}
                  className="flex items-center justify-between gap-2 rounded-md px-1 py-1.5 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                >
                  <span className="text-zinc-500">
                    {new Date(tx.created_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  <span
                    className={`tnum ml-auto font-mono ${
                      tx.amount < 0 ? "text-loss" : "text-profit"
                    }`}
                  >
                    {formatMoney(tx.amount)}
                  </span>
                  <button
                    onClick={() => handleDelete(tx.id)}
                    title="Delete adjustment"
                    className="text-zinc-400 hover:text-loss"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
