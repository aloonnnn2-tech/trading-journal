"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import type { Trade } from "@/lib/trades/types";
import { formatDateTime } from "@/lib/dates/format";

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
  const [loadError, setLoadError] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState(false);

  async function loadHistory() {
    setOpen(true);
    if (history !== null) return;
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/trades/${tradeId}/history`);
      if (!res.ok) throw new Error("Failed to load history");
      const data = (await res.json()) as HistoryEntry[];
      setHistory(data);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  async function handleRestore(historyId: string) {
    setRestoringId(historyId);
    setRestoreError(false);
    try {
      const res = await fetch(`/api/trades/${tradeId}/history/${historyId}/restore`, { method: "POST" });
      if (!res.ok) throw new Error("Restore failed");
      setHistory(null);
      router.refresh();
    } catch {
      setRestoreError(true);
    } finally {
      setRestoringId(null);
    }
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
          {!loading && loadError && (
            <p role="alert" className="text-sm text-loss">
              Couldn&apos;t load history.{" "}
              <button onClick={loadHistory} className="underline hover:no-underline">
                Try again
              </button>
            </p>
          )}
          {!loading && !loadError && history && history.length === 0 && (
            <p className="text-sm text-zinc-500">No earlier versions yet -- every edit saves one.</p>
          )}
          {restoreError && (
            <p role="alert" className="mb-2 text-sm text-loss">Restore failed -- please try again.</p>
          )}
          {!loading && !loadError && history && history.length > 0 && (
            <ul className="flex flex-col gap-2">
              {history.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between rounded-lg border border-zinc-100 dark:border-subtle px-3 py-2"
                >
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">
                    {formatDateTime(entry.createdAt)}
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
