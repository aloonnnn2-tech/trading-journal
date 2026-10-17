"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, PencilLine, X } from "lucide-react";
import type { ProposalView } from "@/lib/chat/proposals";

/**
 * A change Ask suggested. Everything on it was built by the server from the
 * stored, validated proposal -- the model's own words never reach this card
 * except as the values it proposed. Apply is the only thing that changes
 * the journal, and it sends no content: just which proposal.
 */
export function ProposalCard({ proposal: initial }: { proposal: ProposalView }) {
  const [proposal, setProposal] = useState(initial);
  const [busy, setBusy] = useState<"apply" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { display, status } = proposal;

  async function act(action: "apply" | "dismiss") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/chat/proposals/${proposal.id}/${action}`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { proposal?: ProposalView; error?: string };
      if (!res.ok || !body.proposal) setError(body.error ?? "That didn't go through. Try again.");
      else setProposal(body.proposal);
    } catch {
      setError("That didn't go through. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      data-testid="proposal-card"
      className="flex flex-col gap-2.5 rounded-xl border border-primary/30 bg-primary/5 p-3.5 dark:border-primary/25"
    >
      <p className="flex items-start gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
        <PencilLine className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={2} />
        <span>
          <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
            Suggested change
          </span>
          {display.title}
        </span>
      </p>

      <dl className="flex flex-col gap-1.5 text-sm">
        {display.changes.map((c) => (
          <div key={c.label} className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
            <dt className="shrink-0 text-zinc-500 sm:w-32">{c.label}</dt>
            <dd className="min-w-0 whitespace-pre-wrap break-words text-zinc-800 dark:text-zinc-200">
              {c.before && <span className="text-zinc-500 line-through decoration-zinc-400/60">{c.before}</span>}
              {c.before && <span className="text-zinc-500"> → </span>}
              {c.after}
            </dd>
          </div>
        ))}
      </dl>

      {display.note && status === "pending" && <p className="text-xs text-zinc-500">{display.note}</p>}

      {status === "pending" || status === "applying" ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void act("apply")}
            disabled={busy !== null || status === "applying"}
            className="flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-medium text-white hover:brightness-110 disabled:opacity-50 dark:text-zinc-950"
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
            {busy === "apply" || status === "applying" ? "Applying…" : "Apply"}
          </button>
          <button
            type="button"
            onClick={() => void act("dismiss")}
            disabled={busy !== null || status === "applying"}
            className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
          >
            {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
          </button>
          <span className="text-[11px] text-zinc-500">Nothing changes unless you press Apply.</span>
        </div>
      ) : (
        <p role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {status === "applied" && (
            <>
              <span className="flex items-center gap-1 font-medium text-profit">
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                Applied
              </span>
              {display.href && (
                <Link href={display.href} className="text-primary hover:underline">
                  See it
                </Link>
              )}
            </>
          )}
          {status === "dismissed" && (
            <span className="flex items-center gap-1 text-zinc-500">
              <X className="h-3.5 w-3.5" strokeWidth={2.5} />
              Dismissed — nothing was changed.
            </span>
          )}
          {(status === "stale" || status === "failed") && (
            <span className="text-amber-500">Not applied. {proposal.outcome ?? "Nothing was changed."}</span>
          )}
        </p>
      )}

      {error && (
        <p role="alert" className="text-xs text-loss">
          {error}
        </p>
      )}
    </div>
  );
}
