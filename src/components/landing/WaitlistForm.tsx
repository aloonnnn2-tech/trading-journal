"use client";

import { useState, type FormEvent } from "react";
import { HONEYPOT_FIELD, MAX_EMAIL_LENGTH, type WaitlistSource } from "@/lib/waitlist/constants";

// The paid-plan waitlist form (Phase 2B of docs/design-audit.md). Posts to
// /api/waitlist, which answers the same 200 whether the address is new or
// already listed, so this can only ever say "you're on the list".
//
// `id="waitlist"` is a link target: 2C's announcement bar points at /#waitlist.

type Status = "idle" | "submitting" | "success" | "error" | "invalid" | "limited";

const MESSAGES: Partial<Record<Status, string>> = {
  success: "You’re on the list.",
  error: "Couldn’t save that. Try again.",
  // Not in the spec's list of states: "try again" would not fix a typo, so
  // a 400 says what is actually wrong. The browser's own type="email" check
  // catches most of these before they are ever sent.
  invalid: "That doesn’t look like an email address.",
  // Also not in the spec's list. A 429 means "retrying now will fail again",
  // and the generic "Try again" said the opposite -- found by hitting the
  // limit during the live check on 2026-09-27.
  limited: "Too many tries from here. Wait a while, then try again.",
};

export function WaitlistForm({ source, className = "" }: { source: WaitlistSource; className?: string }) {
  const [status, setStatus] = useState<Status>("idle");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setStatus("submitting");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(data.get("email") ?? ""),
          source,
          [HONEYPOT_FIELD]: String(data.get(HONEYPOT_FIELD) ?? ""),
        }),
      });
      setStatus(res.ok ? "success" : res.status === 400 ? "invalid" : res.status === 429 ? "limited" : "error");
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div id="waitlist" className={`scroll-mt-20 ${className}`}>
        <p role="status" className="text-center text-sm font-medium text-profit">
          {MESSAGES.success}
        </p>
      </div>
    );
  }

  const submitting = status === "submitting";
  const message = MESSAGES[status];

  return (
    <div id="waitlist" className={`scroll-mt-20 ${className}`}>
      <form onSubmit={onSubmit} className="mx-auto flex max-w-sm flex-col gap-2 sm:flex-row">
        <label htmlFor="waitlist-email" className="sr-only">
          Email address
        </label>
        <input
          id="waitlist-email"
          name="email"
          type="email"
          required
          maxLength={MAX_EMAIL_LENGTH}
          autoComplete="email"
          placeholder="you@example.com"
          disabled={submitting}
          onChange={() => status !== "idle" && setStatus("idle")}
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-primary disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-600"
        />
        {/* The honeypot. Off-screen rather than display:none, which some
            bots check for; out of the tab order and hidden from assistive
            tech, so no person ever meets it. See src/lib/waitlist/validate.ts. */}
        <input
          type="text"
          name={HONEYPOT_FIELD}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          defaultValue=""
          className="pointer-events-none absolute -left-[9999px] h-px w-px opacity-0"
        />
        <button
          type="submit"
          disabled={submitting}
          className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60 dark:text-zinc-950"
        >
          {submitting ? "Joining…" : "Join the waitlist"}
        </button>
      </form>
      <p aria-live="polite" className={`mt-2 min-h-4 text-center text-xs ${status === "idle" || submitting ? "text-zinc-500" : "text-loss"}`}>
        {message ?? ""}
      </p>
    </div>
  );
}
