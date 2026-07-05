"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import type { Trade } from "@/lib/trades/types";

interface HistoryEntry {
  id: string;
  createdAt: string;
  snapshot: Trade;
}

export function TradeHistoryPanel({ tradeId }: { tradeId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  async function loadHistory() {
    setOpen(true);
    if (history !== null) return;
    setLoading(true);
    const res = await fetch(`/api/trades/${tradeId}/history`);
    const data = (await res.json()) as HistoryEntry[];
    setHistory(data);
    setLoading(false);
  }

  async function handleRestore(historyId: string) {
    setRestoringId(historyId);
    await fetch(`/api/trades/${tradeId}/history/${historyId}/restore`, { method: "POST" });
    setRestoringId(null);
    setHistory(null);
    router.refresh();
  }

  return (
    <Card standalone={false}>
      <button
        onClick={() => (open ? setOpen(false) : loadHistory())}
        className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        Version History {open ? "▲" : "▼"}
      </button>

      {open && (
        <div className="mt-4">
          {loading && <p className="text-sm text-zinc-500">Loading...</p>}
          {!loading && history && history.length === 0 && (
            <p className="text-sm text-zinc-500">No earlier versions yet -- every edit saves one.</p>
          )}
          {!loading && history && history.length > 0 && (
            <ul className="flex flex-col gap-2">
              {history.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between rounded-lg border border-zinc-100 dark:border-subtle px-3 py-2"
                >
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">
                    {new Date(entry.createdAt).toLocaleString()}
                    {" — "}
                    {entry.snapshot.ticker || "Untitled"}, {entry.snapshot.status}
                    {entry.snapshot.dollar_pl !== null && entry.snapshot.dollar_pl !== undefined
                      ? `, $${entry.snapshot.dollar_pl.toFixed(2)}`
                      : ""}
                  </span>
                  <button
                    onClick={() => handleRestore(entry.id)}
                    disabled={restoringId === entry.id}
                    className="rounded-full border border-zinc-300 dark:border-zinc-700 px-3 py-1 text-xs text-zinc-700 dark:text-zinc-200 hover:border-zinc-500 disabled:opacity-50"
                  >
                    {restoringId === entry.id ? "Restoring..." : "Restore"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
