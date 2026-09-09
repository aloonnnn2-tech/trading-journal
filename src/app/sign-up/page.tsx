"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { BrandMark } from "@/components/brand-mark";
import { FormError } from "@/components/form-error";
import { authErrorMessage } from "@/lib/auth/error-messages";
import { useAnalytics } from "@/lib/tracking/useAnalytics";
import { CAPTCHA_ENABLED, Turnstile, type TurnstileHandle } from "@/components/turnstile";

const INPUT_CLASS =
  "rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary";

// Shown when CAPTCHA is configured but no token is available at submit time.
// The previous behaviour sent the call anyway, Supabase answered
// `captcha_failed`, and the user was told "the security check didn't pass" --
// which reads as a rejection when the truth is that the check had not
// finished. Never send a call we already know Supabase will refuse.
const CAPTCHA_INCOMPLETE =
  "Please complete the security check below, then try again.";

export default function SignUpPage() {
  const supabase = createClient();
  const { track } = useAnalytics();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [resent, setResent] = useState(false);
  const captcha = useRef<TurnstileHandle>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const captchaToken = await captcha.current?.getToken();
    if (CAPTCHA_ENABLED && !captchaToken) {
      setError(CAPTCHA_INCOMPLETE);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      // Where the link in the confirmation email lands. The email template
      // sends the user through /auth/confirm, which exchanges the token for
      // a cookie session server-side before forwarding them on.
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=/dashboard`,
        captchaToken,
      },
    });

    // Reset after every completed call -- the token is spent either way.
    captcha.current?.reset();
    setLoading(false);
    if (error) {
      // See src/lib/auth/error-messages.ts -- the SDK's own message is never
      // shown. "User already registered" in particular reads as an error the
      // reader caused rather than a sign-in they should be taking instead.
      setError(authErrorMessage(error));
      return;
    }
    track("signup_completed");

    // With email confirmation switched on in Supabase, signUp() returns a
    // user but no session -- the account isn't usable until the link is
    // clicked. Sending them to /dashboard here would just bounce off the
    // auth check and dump them back on /sign-in with nothing explaining
    // why, so tell them to go and check their inbox instead.
    if (!data.session) {
      setAwaitingConfirmation(true);
      return;
    }
    window.location.href = "/dashboard";
  }

  async function handleResend() {
    setError(null);
    const captchaToken = await captcha.current?.getToken();
    if (CAPTCHA_ENABLED && !captchaToken) {
      setError(CAPTCHA_INCOMPLETE);
      return;
    }
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=/dashboard`,
        captchaToken,
      },
    });
    captcha.current?.reset();
    if (error) {
      setError(authErrorMessage(error));
      return;
    }
    setResent(true);
  }

  if (awaitingConfirmation) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
        <div className="flex w-full max-w-sm flex-col items-start gap-3 rounded-xl border border-zinc-200 dark:border-subtle bg-white dark:bg-card p-8 shadow-[0_1px_2px_rgba(28,27,24,0.05)]">
          <BrandMark className="h-8 w-8" />
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Confirm your email
          </h1>
          <p className="text-sm text-zinc-500">
            We sent a link to{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">{email}</span>. Click it
            and you&apos;ll be signed straight in.
          </p>
          <Turnstile ref={captcha} />
          <FormError>{error}</FormError>
          {resent ? (
            <p role="status" className="text-sm text-zinc-500">
              Sent again. It can take a minute to arrive.
            </p>
          ) : (
            <button
              onClick={handleResend}
              className="text-sm font-medium text-primary hover:underline"
            >
              Didn&apos;t get it? Send it again
            </button>
          )}
          <Link href="/sign-in" className="text-sm font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-zinc-200 dark:border-subtle bg-white dark:bg-card p-8 shadow-[0_1px_2px_rgba(28,27,24,0.05)]"
      >
        <div className="mb-1 flex flex-col items-start gap-3">
          <BrandMark className="h-8 w-8" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Create your account
            </h1>
            <p className="mt-0.5 text-sm text-zinc-500">Free forever. No credit card.</p>
          </div>
        </div>
        <label className="flex flex-col gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Password
          <input
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <Turnstile ref={captcha} />
        <FormError>{error}</FormError>
        <button
          type="submit"
          disabled={loading}
          className="mt-1 rounded-lg bg-primary px-5 py-2.5 font-medium text-white dark:text-zinc-950 hover:brightness-110 disabled:opacity-50"
        >
          {loading ? "Creating account..." : "Sign up"}
        </button>
        <p className="text-center text-sm text-zinc-500">
          Already have an account?{" "}
          <Link href="/sign-in" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
        {/* The legal terms belong at the point the account is actually
            created, not only in a footer three scrolls down the marketing
            page. Same three documents, same plain labels as the footer. */}
        <p className="border-t border-zinc-100 pt-4 text-center text-xs leading-relaxed text-zinc-500 dark:border-subtle">
          By creating an account you agree to our{" "}
          <Link href="/terms" className="font-medium text-primary hover:underline">
            Terms and Conditions
          </Link>
          ,{" "}
          <Link href="/privacy" className="font-medium text-primary hover:underline">
            Privacy Policy
          </Link>
          , and{" "}
          <Link href="/cookies" className="font-medium text-primary hover:underline">
            Cookies Policy
          </Link>
          .
        </p>
      </form>
    </div>
  );
}
