"use client";

import { Suspense, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BrandMark } from "@/components/brand-mark";
import { FormError } from "@/components/form-error";
import { authErrorMessage, isEmailNotConfirmed } from "@/lib/auth/error-messages";
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

export default function SignInPage() {
  // useSearchParams() needs a Suspense boundary to keep this page statically
  // prerenderable -- see SignInForm for the actual form/logic.
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const supabase = createClient();
  const { track } = useAnalytics();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    searchParams.get("error") === "confirmation_failed"
      ? "That confirmation link is invalid or has expired. Please sign up again or request a new link."
      : null,
  );
  const [loading, setLoading] = useState(false);
  // Supabase rejects a sign-in from an account that never clicked its
  // confirmation link. Without an offer to resend, an expired or lost email
  // is a dead end -- the account exists, so signing up again fails too.
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [resent, setResent] = useState(false);
  const captcha = useRef<TurnstileHandle>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNeedsConfirmation(false);
    // Otherwise a second unconfirmed sign-in still shows the "sent again"
    // note from the first one -- claiming an email was sent that wasn't, and
    // hiding the button that would actually send it.
    setResent(false);

    const captchaToken = await captcha.current?.getToken();
    if (CAPTCHA_ENABLED && !captchaToken) {
      setError(CAPTCHA_INCOMPLETE);
      setLoading(false);
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken },
    });

    // Every completed call, not just failed ones: Supabase redeems the token
    // on success too, so leaving it in place would make the next action on
    // this page (a resend, or a second sign-in after signing out) fail with
    // captcha_failed for a reason that has nothing to do with the user.
    captcha.current?.reset();
    setLoading(false);
    if (error) {
      // Never `error.message`: that is GoTrue's own wording, which is written
      // for a log reader and can carry internal detail. See
      // src/lib/auth/error-messages.ts.
      setError(authErrorMessage(error));
      if (isEmailNotConfirmed(error)) setNeedsConfirmation(true);
      return;
    }
    track("login");
    window.location.href = "/dashboard";
  }

  async function handleResend() {
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
              Welcome back
            </h1>
            <p className="mt-0.5 text-sm text-zinc-500">Sign in to your journal.</p>
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
          <div className="flex items-center justify-between">
            Password
            <Link
              href="/forgot-password"
              className="text-xs font-medium text-primary hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <Turnstile ref={captcha} />
        <FormError>{error}</FormError>
        {needsConfirmation &&
          (resent ? (
            // role="status" rather than "alert": this is a confirmation, so it
            // should be announced politely once the screen reader finishes what
            // it is saying, not interrupt mid-sentence the way an error should.
            <p role="status" className="text-sm text-zinc-500">
              Confirmation email sent again. It can take a minute to arrive.
            </p>
          ) : (
            <button
              type="button"
              onClick={handleResend}
              className="self-start text-sm font-medium text-primary hover:underline"
            >
              Resend confirmation email
            </button>
          ))}
        <button
          type="submit"
          disabled={loading}
          className="mt-1 rounded-lg bg-primary px-5 py-2.5 font-medium text-white dark:text-zinc-950 hover:brightness-110 disabled:opacity-50"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
        <p className="text-center text-sm text-zinc-500">
          No account yet?{" "}
          <Link href="/sign-up" className="font-medium text-primary hover:underline">
            Sign up free
          </Link>
        </p>
        {/* zinc-500, not zinc-400: these are real links, and zinc-400 on this
            card sits around 2.6:1 against the background -- below the 4.5:1
            WCAG AA minimum for text this size. */}
        <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-xs text-zinc-500">
          <a href="mailto:TradingLenzSupport@proton.me" className="hover:text-zinc-600 dark:hover:text-zinc-300">
            Contact support
          </a>
          <span aria-hidden="true">·</span>
          <a
            href="mailto:TradingLenzSupport@proton.me?subject=Account%20deletion%20request&body=Please%20delete%20my%20Trading%20Lens%20account%20associated%20with%20this%20email%20address."
            className="hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            Delete my account
          </a>
        </p>
      </form>
    </div>
  );
}
