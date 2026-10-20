"use client";

import { useState } from "react";
import { formatDateTime } from "@/lib/dates/format";
import { useMounted } from "@/lib/use-mounted";
import { topicLabel, type HelpStatus } from "@/lib/help/config";
import type { HelpRequestRow } from "@/lib/help/admin-queries";

const STATUS_STYLE: Record<HelpStatus, string> = {
  open: "bg-primary/10 text-primary",
  answered: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  closed: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

/** A mailto: link that can't be bent by what's in the request: every part encoded. */
function replyHref(r: HelpRequestRow): string {
  const subject = `Re: your Trading Lens help request (${topicLabel(r.topic)})`;
  return `mailto:${encodeURIComponent(r.email)}?subject=${encodeURIComponent(subject)}`;
}

// Everything a request holds is shown as TEXT -- React escapes it -- never as
// HTML, so a message containing markup or script is just characters here.
export function HelpTable({
  initialRequests,
  accounts,
}: {
  initialRequests: HelpRequestRow[];
  accounts: Record<string, string>;
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Dates render after mount: the server's timezone is not the admin's.
  const mounted = useMounted();

  async function setStatus(r: HelpRequestRow, status: HelpStatus) {
    setBusy(r.id);
    setError(null);
    try {
      const res = await fetch("/api/admin/help", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: r.id, status }),
      });
      if (!res.ok) throw new Error();
      setRequests((all) =>
        all.map((x) => (x.id === r.id ? { ...x, status, handled_at: status === "open" ? null : new Date().toISOString() } : x)),
      );
    } catch {
      setError("Couldn't update that request. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(r: HelpRequestRow) {
    if (!window.confirm(`Delete the request from ${r.email}? This can't be undone.`)) return;
    setBusy(r.id);
    setError(null);
    try {
      const res = await fetch("/api/admin/help", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: r.id }),
      });
      if (res.ok || res.status === 404) setRequests((all) => all.filter((x) => x.id !== r.id));
      else throw new Error();
    } catch {
      setError("Couldn't delete that request. Try again.");
    } finally {
      setBusy(null);
    }
  }

  if (requests.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
        Nothing here. Requests sent from the Get help page appear here.
      </p>
    );
  }

  const button =
    "rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:border-primary/50 hover:text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-zinc-100";

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-sm text-loss">
          {error}
        </p>
      )}
      {requests.map((r) => (
        <article
          key={r.id}
          data-testid="help-request"
          className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-subtle dark:bg-card"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${STATUS_STYLE[r.status]}`}>
              {r.status}
            </span>
            <span className="font-medium text-zinc-900 dark:text-zinc-100">{topicLabel(r.topic)}</span>
            <span className="tnum text-zinc-500">{mounted ? formatDateTime(r.created_at) : " "}</span>
          </div>
          <p className="whitespace-pre-wrap break-words text-sm text-zinc-800 dark:text-zinc-200">{r.message}</p>
          <dl className="grid gap-x-4 gap-y-1 text-xs text-zinc-500 sm:grid-cols-[auto_1fr]">
            <dt>From</dt>
            <dd className="break-all text-zinc-700 dark:text-zinc-300">
              {r.name ? `${r.name} · ` : ""}
              {r.email}
            </dd>
            <dt>Account</dt>
            <dd className="break-all">
              {r.user_id ? `Signed in as ${accounts[r.user_id] ?? r.user_id}` : "Not signed in"}
            </dd>
            {r.page && (
              <>
                <dt>Sent from</dt>
                <dd className="break-all">{r.page}</dd>
              </>
            )}
          </dl>
          <div className="flex flex-wrap gap-2">
            <a href={replyHref(r)} className={button}>
              Reply by email
            </a>
            {r.status !== "answered" && (
              <button type="button" disabled={busy === r.id} onClick={() => setStatus(r, "answered")} className={button}>
                Mark answered
              </button>
            )}
            {r.status !== "closed" && (
              <button type="button" disabled={busy === r.id} onClick={() => setStatus(r, "closed")} className={button}>
                Close
              </button>
            )}
            {r.status !== "open" && (
              <button type="button" disabled={busy === r.id} onClick={() => setStatus(r, "open")} className={button}>
                Reopen
              </button>
            )}
            <button
              type="button"
              disabled={busy === r.id}
              onClick={() => remove(r)}
              className="rounded-md px-2.5 py-1 text-xs font-medium text-loss hover:bg-loss/10 disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
