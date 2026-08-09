"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BrandMark } from "@/components/brand-mark";
import { useAnalytics } from "@/lib/tracking/useAnalytics";

const INPUT_CLASS =
  "rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary";

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNeedsConfirmation(false);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);
    if (error) {
      setError(error.message);
      if (error.message.toLowerCase().includes("not confirmed")) setNeedsConfirmation(true);
      return;
    }
    track("login");
    window.location.href = "/dashboard";
  }

  async function handleResend() {
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm?next=/dashboard` },
    });
    if (error) {
      setError(error.message);
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
        {error && <p className="text-sm text-loss">{error}</p>}
        {needsConfirmation &&
          (resent ? (
            <p className="text-sm text-zinc-500">
              Confirmation email sent again — it can take a minute to arrive.
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
        <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-xs text-zinc-400">
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
