"use client";

import { useState } from "react";
import { formatDateTime } from "@/lib/dates/format";
import { useMounted } from "@/lib/use-mounted";
import type { WaitlistEntry } from "@/lib/waitlist/admin-queries";

const SOURCE_LABEL: Record<string, string> = {
  "home-paid-card": "Homepage paid card",
  "app-plans-panel": "In the app (Plans panel)",
};

export function WaitlistTable({ initialEntries }: { initialEntries: WaitlistEntry[] }) {
  const [entries, setEntries] = useState(initialEntries);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Dates render after mount: the server's timezone is not the admin's.
  const mounted = useMounted();

  async function remove(entry: WaitlistEntry) {
    if (!window.confirm(`Remove ${entry.email} from the waitlist? This can't be undone.`)) return;
    setBusy(entry.id);
    setError(null);
    try {
      const res = await fetch("/api/admin/waitlist", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id }),
      });
      // 404 means it was already gone -- the list should agree either way.
      if (res.ok || res.status === 404) setEntries((all) => all.filter((e) => e.id !== entry.id));
      else setError(`Couldn't remove ${entry.email}. Try again.`);
    } catch {
      setError(`Couldn't remove ${entry.email}. Try again.`);
    } finally {
      setBusy(null);
    }
  }

  if (entries.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
        No one has joined yet. Signups from the homepage&apos;s paid card appear here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="alert" className="text-sm text-loss">
          {error}
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-subtle">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] uppercase tracking-[0.08em] text-zinc-500 dark:border-subtle dark:bg-zinc-900/40">
            <tr>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Joined from</th>
              <th className="px-3 py-2 font-medium">Joined</th>
              <th className="px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-b border-zinc-100 last:border-0 dark:border-subtle">
                <td className="px-3 py-2.5 font-medium text-zinc-900 dark:text-zinc-100">{entry.email}</td>
                <td className="px-3 py-2.5 text-zinc-500">
                  {SOURCE_LABEL[entry.source ?? ""] ?? entry.source ?? "—"}
                </td>
                <td className="tnum whitespace-nowrap px-3 py-2.5 text-zinc-500">
                  {mounted ? formatDateTime(entry.created_at) : " "}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => remove(entry)}
                    disabled={busy === entry.id}
                    className="rounded-lg px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-loss/10 hover:text-loss disabled:opacity-50"
                  >
                    {busy === entry.id ? "Removing…" : "Remove"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
