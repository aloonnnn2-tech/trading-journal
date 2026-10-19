"use client";

import { useEffect, useState } from "react";
import type { Provider } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { authErrorMessage } from "@/lib/auth/error-messages";
import { OAUTH_PROVIDERS, enabledProviders } from "@/lib/auth/oauth-providers";

// "Continue with Google" on sign-in and sign-up, above the email form.
//
// Shown only for providers Supabase reports as switched on (its public
// /auth/v1/settings), so nothing appears until the dashboard is set up --
// and nothing at all, divider included, when none are.
//
// No CAPTCHA here: it guards the password and email endpoints, and the
// provider's own sign-in is the check on this path. No terms checkbox
// either: an account without a recorded agreement gets the one-time
// ConsentGate on its first page (src/components/legal/consent-gate.tsx).

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  );
}

const MARKS: Partial<Record<Provider, () => React.ReactNode>> = { google: GoogleMark };

export function OAuthButtons({ next, onError }: { next?: string | null; onError: (message: string | null) => void }) {
  const [enabled, setEnabled] = useState<Provider[]>([]);
  const [going, setGoing] = useState<Provider | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((settings) => {
        if (live) setEnabled(enabledProviders(settings));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // Back from Google's screen restores this page from the browser's memory
  // (bfcache) as it was left: "Opening…", disabled. Wake it up again.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setGoing(null);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  if (enabled.length === 0) return null;

  async function go(provider: Provider) {
    onError(null);
    setGoing(provider);
    const callback = new URL("/auth/callback", window.location.origin);
    if (next) callback.searchParams.set("next", next);
    // Leaves the page for the provider's screen; it only returns on failure.
    const { error } = await createClient().auth.signInWithOAuth({
      provider,
      options: { redirectTo: callback.href },
    });
    if (error) {
      setGoing(null);
      onError(authErrorMessage(error));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {OAUTH_PROVIDERS.filter((p) => enabled.includes(p.id)).map((p) => {
        const Mark = MARKS[p.id];
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => go(p.id)}
            disabled={going !== null}
            className="flex items-center justify-center gap-2.5 rounded-lg border border-zinc-300 bg-white px-5 py-2.5 text-sm font-medium text-zinc-800 hover:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          >
            {Mark && <Mark />}
            {going === p.id ? "Opening…" : `Continue with ${p.label}`}
          </button>
        );
      })}
      <div className="flex items-center gap-3 text-xs text-zinc-500" aria-hidden>
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        or with email
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
      </div>
    </div>
  );
}
