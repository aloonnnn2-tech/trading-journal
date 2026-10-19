"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { authErrorMessage } from "@/lib/auth/error-messages";
import { CAPTCHA_ENABLED, type TurnstileHandle } from "@/components/turnstile";

/** Supabase refuses a second confirmation email to one address within this. */
export const RESEND_COOLDOWN_S = 60;

// "Send the confirmation email again", for as many times as it takes.
//
// It used to be a button that turned into "Sent again" for good after one
// press, on both sign-up and sign-in: a second lost or expired email left no
// way to ask for a third. Now it counts down to the next send Supabase will
// accept, says when the last one went, and stays.
export function ResendConfirmation({
  email,
  captcha,
  onError,
  sentAt = null,
}: {
  email: string;
  captcha: React.RefObject<TurnstileHandle | null>;
  onError: (message: string | null) => void;
  /** When an email was last sent to this address from this screen (sign-up just sent one). */
  sentAt?: number | null;
}) {
  const [lastSent, setLastSent] = useState<number | null>(sentAt);
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const wait = lastSent === null ? 0 : Math.max(0, RESEND_COOLDOWN_S - Math.floor((now - lastSent) / 1000));

  useEffect(() => {
    if (wait <= 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [wait]);

  async function send() {
    onError(null);
    setSending(true);
    const captchaToken = await captcha.current?.getToken();
    if (CAPTCHA_ENABLED && !captchaToken) {
      onError(captcha.current?.problem() ?? "Please complete the security check, then try again.");
      setSending(false);
      return;
    }
    const { error } = await createClient().auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=/dashboard`,
        captchaToken: captchaToken ?? undefined,
      },
    });
    captcha.current?.reset();
    setSending(false);
    if (error) {
      onError(authErrorMessage(error));
      // Supabase's own limit was hit: wait it out before the next try.
      if (error.code === "over_email_send_rate_limit") {
        setLastSent(Date.now());
        setNow(Date.now());
      }
      return;
    }
    setLastSent(Date.now());
    setNow(Date.now());
  }

  return (
    <div className="flex flex-col items-start gap-1">
      {lastSent !== null && (
        <p role="status" className="text-sm text-zinc-500">
          Sent at {new Date(lastSent).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. It can
          take a minute to arrive; check spam too. Only the newest email&apos;s link works.
        </p>
      )}
      <button
        type="button"
        onClick={send}
        disabled={sending || wait > 0}
        className="text-sm font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:text-zinc-400 disabled:no-underline"
      >
        {sending
          ? "Sending…"
          : wait > 0
            ? `Send it again in ${wait}s`
            : lastSent === null
              ? "Resend confirmation email"
              : "Send it again"}
      </button>
    </div>
  );
}
