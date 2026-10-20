"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FormError } from "@/components/form-error";
import { CAPTCHA_ENABLED, Turnstile, type TurnstileHandle } from "@/components/turnstile";
import { authApi } from "@/lib/auth/client-api";
import {
  HELP_CAPTCHA_ACTION,
  HELP_TOPICS,
  HONEYPOT_FIELD,
  MESSAGE_MAX,
  MESSAGE_MIN,
  NAME_MAX,
  type HelpTopic,
} from "@/lib/help/config";

const INPUT_CLASS =
  "rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary";
const LABEL_CLASS = "flex flex-col gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400";

// The "Get help" form (/help). Works signed in or out; signed in, the email
// is filled in for you. Everyone passes the robot check (Alon, 2026-10-20),
// which our server verifies itself (src/app/api/help/route.ts).
export function HelpForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [topic, setTopic] = useState<HelpTopic | "">("");
  const [message, setMessage] = useState("");
  const [trap, setTrap] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const captcha = useRef<TurnstileHandle>(null);

  useEffect(() => {
    let live = true;
    authApi.session().then(({ email: own }) => {
      if (live && own) setEmail((current) => current || own);
    });
    return () => {
      live = false;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!topic) {
      setError("Choose what it's about.");
      return;
    }
    setSending(true);
    const captchaToken = await captcha.current?.getToken();
    if (CAPTCHA_ENABLED && !captchaToken) {
      setError(captcha.current?.problem() ?? "Please complete the security check below, then send.");
      setSending(false);
      return;
    }
    let res: Response | null = null;
    try {
      res = await fetch("/api/help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          name: name || null,
          topic,
          message,
          page: searchParams.get("from"),
          captchaToken,
          [HONEYPOT_FIELD]: trap,
        }),
      });
    } catch {
      res = null;
    }
    // A token is spent once sent, whatever the answer.
    captcha.current?.reset();
    setSending(false);
    if (!res) {
      setError("Couldn't reach Trading Lens. Check your internet connection and try again.");
      return;
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Something went wrong. Please try again.");
      return;
    }
    setSentTo(email);
  }

  if (sentTo) {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-6 dark:border-subtle dark:bg-card">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Thanks, your message is in</h2>
        <p className="text-sm text-zinc-500">
          We&apos;ll reply by email to <span className="font-medium text-zinc-700 dark:text-zinc-300">{sentTo}</span>.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-[0_1px_2px_rgba(28,27,24,0.05)] dark:border-subtle dark:bg-card"
    >
      <label className={LABEL_CLASS}>
        Your email
        <input
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={INPUT_CLASS}
        />
        <span className="font-normal text-zinc-500">So we can reply. We don&apos;t use it for anything else.</span>
      </label>
      <label className={LABEL_CLASS}>
        Name (optional)
        <input
          type="text"
          maxLength={NAME_MAX}
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={INPUT_CLASS}
        />
      </label>
      <label className={LABEL_CLASS}>
        What&apos;s it about?
        <select required value={topic} onChange={(e) => setTopic(e.target.value as HelpTopic)} className={INPUT_CLASS}>
          <option value="" disabled>
            Choose one
          </option>
          {HELP_TOPICS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className={LABEL_CLASS}>
        How can we help?
        <textarea
          required
          minLength={MESSAGE_MIN}
          maxLength={MESSAGE_MAX}
          rows={6}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className={`${INPUT_CLASS} resize-y`}
        />
        <span className="font-normal text-zinc-500">
          {message.length.toLocaleString("en-US")} / {MESSAGE_MAX.toLocaleString("en-US")}
        </span>
      </label>
      {/* The honeypot: off-screen, unreachable by keyboard, hidden from
          screen readers. People never fill it; bots that fill every field do. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label>
          Website
          <input
            type="text"
            name={HONEYPOT_FIELD}
            tabIndex={-1}
            autoComplete="off"
            value={trap}
            onChange={(e) => setTrap(e.target.value)}
          />
        </label>
      </div>
      <Turnstile ref={captcha} action={HELP_CAPTCHA_ACTION} />
      <FormError>{error}</FormError>
      <button
        type="submit"
        disabled={sending}
        className="mt-1 rounded-lg bg-primary px-5 py-2.5 font-medium text-white hover:brightness-110 disabled:opacity-50 dark:text-zinc-950"
      >
        {sending ? "Sending..." : "Send"}
      </button>
    </form>
  );
}
