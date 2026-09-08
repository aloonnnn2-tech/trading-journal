"use client";

import { useState } from "react";
import { TOGGLEABLE_CORE_FIELDS, type EditableCoreField } from "@/lib/trades/types";

export function CoreFieldToggles({ initialHidden }: { initialHidden: EditableCoreField[] }) {
  const [hidden, setHidden] = useState(new Set(initialHidden));
  // The toggle flips optimistically below with no way to know it failed
  // until reload silently reverted it -- same "didn't save" pattern the
  // dashboard layout drag already uses (dashboard-grid.tsx), just missing
  // here until now.
  const [saveFailed, setSaveFailed] = useState(false);

  async function toggle(field: EditableCoreField) {
    const isHidden = hidden.has(field);
    const next = new Set(hidden);
    if (isHidden) next.delete(field);
    else next.add(field);
    setHidden(next);

    try {
      const res = await fetch("/api/settings/core-fields", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, hidden: !isHidden }),
      });
      setSaveFailed(!res.ok);
    } catch {
      setSaveFailed(true);
    }
  }

  return (
    <ul className="flex flex-col gap-2">
      {saveFailed && (
        <li role="status" className="text-xs text-loss">
          That change couldn&apos;t be saved. It&apos;ll revert on reload. Check your connection and try again.
        </li>
      )}
      {TOGGLEABLE_CORE_FIELDS.map(({ key, label }) => (
        <li
          key={key}
          className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-subtle bg-white dark:bg-card px-4 py-2"
        >
          <span className="text-zinc-900 dark:text-zinc-100">{label}</span>
          <label className="flex items-center gap-2 text-xs text-zinc-500">
            {hidden.has(key) ? "Hidden" : "Shown"}
            <input
              type="checkbox"
              checked={!hidden.has(key)}
              onChange={() => toggle(key)}
              className="h-4 w-4"
            />
          </label>
        </li>
      ))}
    </ul>
  );
}