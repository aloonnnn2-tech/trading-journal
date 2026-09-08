"use client";

import { useState } from "react";
import { FormError } from "@/components/form-error";
import { useRouter } from "next/navigation";
import { Tags } from "lucide-react";
import { Card } from "@/components/ui/Card";
import type { Suggestion } from "@/lib/mistakes/suggestions";

// Tags the app noticed, offered rather than applied.
//
// **Nothing here is written until it is clicked.** The suggestions are
// recomputed on the server from the trade's own numbers and its edit history,
// and they stay suggestions -- the journal is the trader's record of what they
// did, and an app that quietly writes "Oversized position" into it is editing
// their diary. Accepting adds the label to the Mistakes field exactly as if
// they had typed it; dismissing records that they considered it and said no.
//
// **No AI is involved**, deliberately. Everything offered here is arithmetic
// over data already stored: a stop or target that changed after the trade was
// logged, an exit short of the recorded target on a winner, a risk well above
// this trader's own median. The tags a model would have to guess at instead --
// FOMO, "A+ setup", chased entry -- depend on either a judgement only the
// trader can make or data this app does not hold, and guessing at those would
// be inventing journal entries rather than surfacing them.

export function TagSuggestionsPanel({
  tradeId,
  suggestions,
}: {
  tradeId: string;
  suggestions: Suggestion[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Locally hidden the moment an action succeeds, so the row goes away without
  // waiting for the refresh -- the server is still the source of truth, this
  // only removes the gap where a clicked row sits there looking unhandled.
  const [handled, setHandled] = useState<string[]>([]);

  const visible = suggestions.filter((s) => !handled.includes(s.label));

  // Nothing to offer is the normal state on most trades, and an empty panel
  // saying so would be noise on every one of them.
  if (visible.length === 0) return null;

  async function act(label: string, action: "accept" | "dismiss") {
    setBusy(label);
    setError(null);
    try {
      const response = await fetch(`/api/trades/${tradeId}/suggestions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, action }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(
          typeof payload.error === "string"
            ? payload.error
            : "That didn't save. Nothing was changed on the trade.",
        );
        return;
      }
      setHandled((prev) => [...prev, label]);
      // The tag has to appear on the trade card above, and the suggestion has
      // to stop being suggested -- both are server-rendered from the row.
      router.refresh();
    } catch {
      setError("That didn't save. Nothing was changed on the trade.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card standalone={false} className="flex flex-col gap-3">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          <Tags className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
          Suggested tags
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Things this trade&rsquo;s own numbers point at. Nothing is added to your journal until
          you say so.
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {visible.map((suggestion) => (
          <li
            key={suggestion.label}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-subtle"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {suggestion.label}
              </p>
              {/* The reason travels with the suggestion so it can be judged
                  rather than accepted on trust. */}
              <p className="text-xs text-zinc-500">Because {suggestion.reason}.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => act(suggestion.label, "accept")}
                className="rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-white hover:brightness-110 disabled:opacity-50 dark:text-zinc-950"
              >
                {busy === suggestion.label ? "Adding…" : "Add tag"}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => act(suggestion.label, "dismiss")}
                className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Dismiss
              </button>
            </div>
          </li>
        ))}
      </ul>

      <FormError className="rounded-lg border border-loss/40 px-3 py-2">{error}</FormError>

      <p className="border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-subtle">
        Adding one puts the label in your Mistakes field, where it counts toward the mistake
        tracker and your goals like any tag you write yourself.
      </p>
    </Card>
  );
}
