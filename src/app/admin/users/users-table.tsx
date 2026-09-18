"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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

export function UsersTable({
  users,
  currentUserId,
}: {
  users: UserDirectoryRow[];
  currentUserId: string;
}) {
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("lastActiveAt");
  const [desc, setDesc] = useState(true);

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

  const paid = users.filter((u) => u.plan === "paid").length;

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
          {users.length} users · {paid} paid · showing {visible.length}
        </p>
      </div>

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
            </tr>
          </thead>
          <tbody>
            {visible.map((u) => (
              <tr
                key={u.id}
                className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-subtle dark:hover:bg-zinc-900/40"
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
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-4 py-6 text-center text-sm text-zinc-500">
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
