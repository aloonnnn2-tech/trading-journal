"use client";

import { useId, useState } from "react";
import { Card } from "@/components/ui/Card";

// The switches on Setup -> Settings. Each saves the moment it's flipped and
// says so; a failed save puts the switch back and says that instead.
export function SettingsForm({ initialShowTradeSummary }: { initialShowTradeSummary: boolean | null }) {
  const available = initialShowTradeSummary !== null;
  const [on, setOn] = useState(initialShowTradeSummary ?? true);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const labelId = useId();
  const hintId = useId();

  async function toggle() {
    const next = !on;
    setOn(next);
    setStatus("saving");
    try {
      const res = await fetch("/api/settings/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showTradeSummary: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus("saved");
    } catch {
      setOn(!next);
      setStatus("error");
    }
  }

  return (
    <Card standalone={false} hoverable={false} className="flex items-start justify-between gap-6">
      <div>
        <p id={labelId} className="font-medium text-zinc-900 dark:text-zinc-50">
          Summary strip on the Trades page
        </p>
        <p id={hintId} className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Net P/L, win rate, profit factor, average hold, trade count and expectancy for the trades your filters show,
          above the trade list.
        </p>
        <p aria-live="polite" className="mt-2 min-h-5 text-xs">
          {!available ? (
            <span className="text-zinc-500">
              This setting will be available shortly. Until then the strip is always shown.
            </span>
          ) : status === "saved" ? (
            <span className="text-profit">Saved.</span>
          ) : status === "error" ? (
            <span className="text-loss">Couldn&apos;t save that. Try again.</span>
          ) : null}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={labelId}
        aria-describedby={hintId}
        disabled={!available || status === "saving"}
        onClick={toggle}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
          on ? "bg-primary" : "bg-zinc-300 dark:bg-zinc-700"
        }`}
      >
        <span
          aria-hidden
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`}
        />
      </button>
    </Card>
  );
}
