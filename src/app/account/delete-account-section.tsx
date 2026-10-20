"use client";

import { useEffect, useRef, useState } from "react";
import { FormError } from "@/components/form-error";
import { CAPTCHA_ENABLED, Turnstile, type TurnstileHandle } from "@/components/turnstile";
import { authErrorMessage } from "@/lib/auth/error-messages";

/** Supabase sends one link per address per minute. */
const RESEND_AFTER_S = 60;

// Deleting an account takes the account's inbox (2026-10-20): this asks for
// a confirmation link, and the account is only deleted from that link
// (/account/delete/confirm). Typing the address used to be the check, which
// anyone in front of a signed-in browser -- or a script in the page -- could
// do.
export function DeleteAccountSection({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const captcha = useRef<TurnstileHandle>(null);
  const wait = sentAt === null ? 0 : Math.max(0, RESEND_AFTER_S - Math.floor((now - sentAt) / 1000));

  useEffect(() => {
    if (wait <= 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [wait]);

  async function sendLink() {
    setError(null);
    setSending(true);
    const captchaToken = await captcha.current?.getToken();
    if (CAPTCHA_ENABLED && !captchaToken) {
      setError(captcha.current?.problem() ?? "Please complete the security check, then try again.");
      setSending(false);
      return;
    }
    let res: Response | null = null;
    try {
      res = await fetch("/api/account/delete/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captchaToken }),
      });
    } catch {
      res = null;
    }
    // The token is spent once sent, whatever the answer.
    captcha.current?.reset();
    setSending(false);
    if (!res) {
      setError("Couldn't reach Trading Lens. Check your internet connection and try again.");
      return;
    }
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    if (!res.ok) {
      // Either our own message, or Supabase's error code in the auth shape.
      setError(typeof body?.error === "string" ? body.error : authErrorMessage(body?.error));
      return;
    }
    setSentAt(Date.now());
    setNow(Date.now());
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-loss px-4 py-2 text-sm font-medium text-loss hover:bg-loss/10"
      >
        Delete account
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-loss/40 bg-loss/5 p-4">
      {sentAt === null ? (
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          We&apos;ll email a confirmation link to <span className="font-semibold">{email}</span>. Your account is
          deleted only after you open that link and confirm.
        </p>
      ) : (
        <p role="status" className="text-sm text-zinc-700 dark:text-zinc-300">
          We sent a link to <span className="font-semibold">{email}</span> at{" "}
          {new Date(sentAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Open it within an hour
          to finish deleting your account. Check spam too; only the newest email&apos;s link works.
        </p>
      )}
      <Turnstile ref={captcha} />
      <FormError>{error}</FormError>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={sendLink}
          disabled={sending || wait > 0}
          className="rounded-lg bg-loss px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending
            ? "Sending..."
            : sentAt === null
              ? "Email me the link"
              : wait > 0
                ? `Send again in ${wait}s`
                : "Send the link again"}
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={sending}
          className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
