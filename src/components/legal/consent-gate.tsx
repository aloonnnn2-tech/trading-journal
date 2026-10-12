"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { useDialog } from "@/lib/a11y/use-dialog";
import { createClient } from "@/lib/supabase/client";
import { endSession } from "@/lib/tracking/useAnalytics";
import { MINIMUM_AGE, TERMS_VERSION } from "@/lib/legal/terms";

// One-time confirmation for accounts that existed before the sign-up
// checkbox (Alon, 2026-10-09: "existing users re-confirm"). Rendered by the
// root layout only when the account has no recorded agreement; the server
// decides that (src/lib/legal/consent.ts), so this never shows to someone
// who already agreed.
//
// Not shown on the pages it asks you to agree to, so they can be read first.
// Escape does nothing: the only ways out are agreeing or signing out.

const READABLE_WITHOUT_AGREEING = new Set(["/terms", "/privacy", "/cookies", "/contact"]);

export function ConsentGate() {
  const pathname = usePathname();
  const router = useRouter();
  const titleId = useId();
  const boxRef = useRef<HTMLInputElement>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = !done && !READABLE_WITHOUT_AGREEING.has(pathname);
  const dialogRef = useDialog({ open, onClose: () => {}, closeOnEscape: false, initialFocusRef: boxRef });

  if (!open) return null;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ age_confirmed: true, accepted_terms_version: TERMS_VERSION }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not save that. Please try again.");
      }
      setDone(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that. Please try again.");
      setBusy(false);
    }
  }

  async function signOut() {
    endSession();
    try {
      await createClient().auth.signOut();
    } catch {
      // Navigate away regardless, as the nav bar's sign-out does.
    }
    // A real navigation, as in nav-bar.tsx: router.push + refresh can race
    // and leave the page looking signed in.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/";
  }

  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-8 shadow-2xl dark:border-subtle dark:bg-card"
      >
        <BrandMark className="h-10 w-10" />
        <div>
          <h1 id={titleId} className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            One quick confirmation
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            We&apos;ve updated our Terms and Privacy Policy, and Trading Lens is for adults only. Please
            confirm both to keep using your account.
          </p>
        </div>
        <label className="flex items-start gap-2.5 text-sm leading-snug text-zinc-600 dark:text-zinc-400">
          <input
            ref={boxRef}
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
          />
          <span>
            I&apos;m {MINIMUM_AGE} or older and I agree to the{" "}
            <Link href="/terms" target="_blank" className="font-medium text-primary hover:underline">
              Terms and Conditions
            </Link>{" "}
            and{" "}
            <Link href="/privacy" target="_blank" className="font-medium text-primary hover:underline">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        {error && (
          <p role="alert" className="text-sm text-loss">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-2">
          <button
            onClick={confirm}
            disabled={!agreed || busy}
            className="w-full rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50 dark:text-zinc-950"
          >
            {busy ? "Saving…" : "Continue"}
          </button>
          <button
            onClick={signOut}
            disabled={busy}
            className="w-full rounded-lg px-5 py-2.5 text-sm text-zinc-500 hover:text-zinc-900 disabled:opacity-60 dark:hover:text-zinc-100"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
