"use client";

import { useMemo, useState } from "react";
import type { AdminUserPlan } from "@/lib/settings/admin-queries";
import type { UserPlan } from "@/lib/settings/plan";

const inputClass =
  "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary";

export function PlanManager({
  initialUsers,
  currentUserId,
}: {
  initialUsers: AdminUserPlan[];
  currentUserId: string;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [filter, setFilter] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((u) => (u.email ?? "").toLowerCase().includes(needle));
  }, [users, filter]);

  async function handleToggle(user: AdminUserPlan) {
    const next: UserPlan = user.plan === "paid" ? "free" : "paid";
    if (
      next === "free" &&
      !confirm(`Revoke the paid plan from ${user.email ?? user.userId}? They lose AI access.`)
    ) {
      return;
    }

    setPendingId(user.userId);
    setError(null);

    const res = await fetch("/api/admin/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.userId, plan: next }),
    });
    setPendingId(null);

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      // Surface the failure rather than leaving the row showing its old value
      // with no explanation -- a silently-failed grant looks identical to a
      // broken paywall from the user's side.
      setError(body?.error ?? "Couldn't change that plan.");
      return;
    }

    setUsers((prev) =>
      prev.map((u) => (u.userId === user.userId ? { ...u, plan: next } : u)),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <input
        type="search"
        placeholder="Filter by email"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className={inputClass}
      />

      {error && <p className="text-sm text-red-400">{error}</p>}

      <ul className="flex flex-col gap-2">
        {visible.map((user) => (
          <li
            key={user.userId}
            className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 dark:border-subtle bg-white dark:bg-card px-4 py-2"
          >
            <div className="min-w-0">
              <span className="block truncate text-sm text-zinc-900 dark:text-zinc-100">
                {user.email ?? <span className="text-zinc-500">(no email)</span>}
                {user.userId === currentUserId && (
                  <span className="ml-2 text-xs text-zinc-500">you</span>
                )}
              </span>
              <span className="text-xs text-zinc-500">
                Joined {new Date(user.createdAt).toLocaleDateString()}
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  user.plan === "paid"
                    ? "bg-profit/10 text-profit"
                    : "bg-zinc-500/10 text-zinc-500"
                }`}
              >
                {user.plan}
              </span>
              <button
                onClick={() => handleToggle(user)}
                disabled={pendingId === user.userId}
                className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-white dark:text-zinc-950 hover:brightness-110 disabled:opacity-50"
              >
                {pendingId === user.userId
                  ? "Saving..."
                  : user.plan === "paid"
                    ? "Make free"
                    : "Make paid"}
              </button>
            </div>
          </li>
        ))}
        {visible.length === 0 && (
          <p className="text-sm text-zinc-500">No users match that filter.</p>
        )}
      </ul>
    </div>
  );
}
