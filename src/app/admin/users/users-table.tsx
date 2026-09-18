"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import type { UserDirectoryRow } from "@/lib/tracking/admin-queries";
import { formatDate } from "@/lib/dates/format";
import { formatActive, formatRelative } from "./format";

const inputClass =
  "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary sm:max-w-sm";

type SortKey = "lastActiveAt" | "signedUpAt" | "tradeCount" | "clicksTotal" | "activeSeconds" | "aiQuestions";

const COLUMNS: { key: SortKey; label: string; hint: string }[] = [
  { key: "lastActiveAt", label: "Last seen", hint: "Most recent heartbeat from any tab" },
  { key: "signedUpAt", label: "Joined", hint: "Account creation date" },
  { key: "tradeCount", label: "Trades", hint: "Total, with open / closed split" },
  { key: "activeSeconds", label: "Active time", hint: "Summed across all sessions" },
  { key: "clicksTotal", label: "Clicks", hint: "Every interactive click, last 90 days" },
  { key: "aiQuestions", label: "AI asks", hint: "Questions answered on /ask" },
];

// True when the domain rule (0044) would hide this account regardless of the
// manual flag -- used only to decide whether the toggle button does anything.
// A test-domain address stays hidden no matter how it's clicked; this keeps
// that honest instead of showing a button that would silently do nothing.
const TEST_DOMAIN = /@[^@]+\.(test|invalid|example|localhost)$/i;

export function UsersTable({
  users: initialUsers,
  currentUserId,
}: {
  users: UserDirectoryRow[];
  currentUserId: string;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("lastActiveAt");
  const [desc, setDesc] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const rows = q ? users.filter((u) => u.email.toLowerCase().includes(q)) : users.slice();
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      // Nulls (never active) always sink to the bottom regardless of direction.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const an = typeof av === "number" ? av : new Date(av).getTime();
      const bn = typeof bv === "number" ? bv : new Date(bv).getTime();
      return desc ? bn - an : an - bn;
    });
    return rows;
  }, [users, filter, sortKey, desc]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setDesc((d) => !d);
    else {
      setSortKey(key);
      setDesc(true);
    }
  }

  async function handleToggleExcluded(user: UserDirectoryRow) {
    const next = !user.excluded;
    setPendingId(user.id);
    setError(null);

    const res = await fetch("/api/admin/analytics-exclusion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id, excluded: next }),
    });
    setPendingId(null);

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Couldn't change that.");
      return;
    }

    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, excluded: next } : u)));
  }

  const paid = users.filter((u) => u.plan === "paid").length;
  const excluded = users.filter((u) => u.excluded).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          placeholder="Filter by email"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className={inputClass}
        />
        <p className="text-xs text-zinc-500">
          {users.length} users · {paid} paid · {excluded} excluded from analytics · showing {visible.length}
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-loss">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-subtle">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-950/40">
            <tr className="border-b border-zinc-200 dark:border-subtle">
              <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                User
              </th>
              {COLUMNS.map((c) => (
                <th key={c.key} className="px-3 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort(c.key)}
                    title={c.hint}
                    className={`text-xs font-semibold uppercase tracking-wide hover:text-zinc-900 dark:hover:text-zinc-100 ${
                      sortKey === c.key ? "text-primary" : "text-zinc-500"
                    }`}
                  >
                    {c.label}
                    {sortKey === c.key ? (desc ? " ↓" : " ↑") : ""}
                  </button>
                </th>
              ))}
              <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Analytics
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((u) => {
              const domainHidden = TEST_DOMAIN.test(u.email);
              return (
                <tr
                  key={u.id}
                  className={`border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-subtle dark:hover:bg-zinc-900/40 ${
                    u.excluded ? "opacity-60" : ""
                  }`}
                >
                  <td className="px-4 py-2.5">
                    <Link href={`/admin/users/${u.id}`} className="group block min-w-0">
                      <span className="block truncate font-medium text-zinc-900 group-hover:text-primary dark:text-zinc-100">
                        {u.email}
                        {u.id === currentUserId && <span className="ml-2 text-xs font-normal text-zinc-500">you</span>}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs">
                        <span
                          className={`rounded-full px-1.5 py-px font-medium ${
                            u.plan === "paid" ? "bg-profit/10 text-profit" : "bg-zinc-500/10 text-zinc-500"
                          }`}
                        >
                          {u.plan}
                        </span>
                        {u.admin && (
                          <span className="rounded-full bg-primary/10 px-1.5 py-px font-medium text-primary">
                            admin
                          </span>
                        )}
                        {u.excluded && (
                          <span
                            title={domainHidden ? "Hidden — test-domain email" : "Hidden — marked manually"}
                            className="rounded-full bg-amber-500/10 px-1.5 py-px font-medium text-amber-600 dark:text-amber-400"
                          >
                            excluded
                          </span>
                        )}
                      </span>
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                    {formatRelative(u.lastActiveAt)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-zinc-500">
                    {formatDate(u.signedUpAt)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                    {u.tradeCount}
                    <span className="ml-1 text-xs text-zinc-500">
                      ({u.openTrades} open · {u.closedTrades} closed)
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                    {formatActive(u.activeSeconds)}
                    <span className="ml-1 text-xs text-zinc-500">/ {u.sessionCount} sessions</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                    {u.clicksTotal}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                    {u.aiQuestions}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">
                    {domainHidden ? (
                      <span title="Always hidden — test-domain email, not a toggle" className="text-xs text-zinc-400">
                        test domain
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleToggleExcluded(u)}
                        disabled={pendingId === u.id}
                        title={u.excluded ? "Include in analytics again" : "Exclude from analytics"}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                      >
                        {u.excluded ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        {pendingId === u.id ? "Saving…" : u.excluded ? "Excluded" : "Exclude"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 2} className="px-4 py-6 text-center text-sm text-zinc-500">
                  {users.length === 0 ? "No users yet." : "No users match that filter."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
