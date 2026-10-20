"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { authApi } from "@/lib/auth/client-api";
import { BrandMark } from "@/components/brand-mark";
import { FormError } from "@/components/form-error";
import { authErrorMessage, isEmailNotConfirmed } from "@/lib/auth/error-messages";
import { ResendConfirmation } from "@/components/auth/resend-confirmation";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { useAnalytics } from "@/lib/tracking/useAnalytics";
import { CAPTCHA_ENABLED, Turnstile, type TurnstileHandle } from "@/components/turnstile";
import { MINIMUM_AGE } from "@/lib/legal/terms";

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
  const { track } = useAnalytics();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [continuing, setContinuing] = useState(false);
  // When sign-up sent the first email: the resend counts down from it.
  const [sentAt, setSentAt] = useState<number | null>(null);
  const captcha = useRef<TurnstileHandle>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // The checkbox is `required`, so the browser normally stops the submit
    // first; this covers a form submitted some other way.
    if (!agreed) {
      setError(`Please confirm you're ${MINIMUM_AGE} or older and agree to the Terms and Privacy Policy.`);
      return;
    }
    setLoading(true);
    setError(null);

    const captchaToken = await captcha.current?.getToken();
    if (CAPTCHA_ENABLED && !captchaToken) {
      setError(captcha.current?.problem() ?? CAPTCHA_INCOMPLETE);
      setLoading(false);
      return;
    }
    // On the server (src/app/api/auth/sign-up/route.ts), which sets the
    // confirmation link and records the age and terms agreement (0061).
    const result = await authApi.signUp(email, password, captchaToken ?? undefined);
    const error = result.error;

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
    if (!("session" in result) || !result.session) {
      setSentAt(Date.now());
      setAwaitingConfirmation(true);
      return;
    }
    window.location.href = "/dashboard";
  }

  // "Already confirmed": sign in with what they just typed. This is the way
  // out when the link said "expired" because something else opened it first
  // -- the account is confirmed, and a resend would send nothing (Supabase
  // sends no confirmation to a confirmed address, and still answers "sent").
  async function handleContinue() {
    setError(null);
    setContinuing(true);
    const captchaToken = await captcha.current?.getToken();
    if (CAPTCHA_ENABLED && !captchaToken) {
      setError(captcha.current?.problem() ?? CAPTCHA_INCOMPLETE);
      setContinuing(false);
      return;
    }
    const { error } = await authApi.signIn(email, password, captchaToken ?? undefined);
    captcha.current?.reset();
    setContinuing(false);
    if (error) {
      setError(
        isEmailNotConfirmed(error)
          ? "Your email isn't confirmed yet. Open the link in the newest email, or send a new one below."
          : authErrorMessage(error),
      );
      return;
    }
    window.location.href = "/dashboard";
  }

  if (awaitingConfirmation) {
    return (
      <div
      data-v2-page="auth"
      className="flex flex-1 flex-col items-center justify-center px-6 py-16"
    >
        <div className="flex w-full max-w-sm flex-col items-start gap-3 rounded-xl border border-zinc-200 dark:border-subtle bg-white dark:bg-card p-8 shadow-[0_1px_2px_rgba(28,27,24,0.05)]">
          <BrandMark className="h-8 w-8" />
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Confirm your email
          </h1>
          <p className="text-sm text-zinc-500">
            We sent a link to{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">{email}</span>. Open it
            and press &ldquo;Confirm my email&rdquo; to sign straight in.
          </p>
          <Turnstile ref={captcha} />
          <FormError>{error}</FormError>
          <button
            type="button"
            onClick={handleContinue}
            disabled={continuing}
            className="w-full rounded-lg border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-800 hover:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-100"
          >
            {continuing ? "Checking…" : "I've confirmed it, continue"}
          </button>
          <ResendConfirmation email={email} captcha={captcha} onError={setError} sentAt={sentAt} />
          <Link href="/sign-in" className="text-sm font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      data-v2-page="auth"
      className="flex flex-1 flex-col items-center justify-center px-6 py-16"
    >
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
        <OAuthButtons onError={setError} />
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
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        {/* Required: Part B of the security hardening brief. An unchecked box
            blocks the submit, and the agreement is recorded per account
            (migration 0061). */}
        <label className="flex items-start gap-2.5 text-sm leading-snug text-zinc-600 dark:text-zinc-400">
          <input
            type="checkbox"
            required
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
          />
          <span>
            I&apos;m {MINIMUM_AGE} or older and I agree to the{" "}
            <Link href="/terms" className="font-medium text-primary hover:underline">
              Terms and Conditions
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="font-medium text-primary hover:underline">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        <Turnstile ref={captcha} />
        <FormError>{error}</FormError>
        <button
          type="submit"
          disabled={loading || !agreed}
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
        <p className="text-center text-xs text-zinc-500">
          Stuck?{" "}
          <Link href="/help?from=/sign-up" className="hover:text-zinc-600 dark:hover:text-zinc-300">
            Get help
          </Link>
        </p>
        {/* The Terms and Privacy Policy are agreed to by the checkbox above;
            the Cookies Policy is information, not an agreement, so it stays
            a plain link. */}
        <p className="border-t border-zinc-100 pt-4 text-center text-xs leading-relaxed text-zinc-500 dark:border-subtle">
          How we use cookies:{" "}
          <Link href="/cookies" className="font-medium text-primary hover:underline">
            Cookies Policy
          </Link>
          .
        </p>
      </form>
    </div>
  );
}
