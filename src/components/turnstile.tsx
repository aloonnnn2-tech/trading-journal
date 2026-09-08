"use client";

/**
 * Cloudflare Turnstile widget for the four screens that call Supabase Auth
 * directly from the browser.
 *
 * **Why these screens and no others.** src/lib/rate-limit.ts is enforced in
 * src/proxy.ts and covers /api/* only. `signUp`, `signInWithPassword`,
 * `resetPasswordForEmail` and `resend` go straight from the browser to
 * Supabase and never touch this app's server, so there is nowhere in this
 * codebase they could be rate limited -- SECURITY.md §1 says so at length.
 * CAPTCHA is the one control that applies where those requests actually land.
 *
 * **No wrapper dependency, deliberately.** @marsidev/react-turnstile would do
 * this, but the API is small and the CSP interaction (see below) is the part
 * most likely to break sign-in -- burying it inside a package makes it
 * invisible at exactly the moment it matters.
 *
 * **CSP.** The injected script inherits trust from `strict-dynamic` (it is
 * added by already-trusted React code, so it needs no nonce), but the widget
 * renders in an IFRAME from challenges.cloudflare.com. src/proxy.ts must
 * therefore allow that origin in `frame-src` and `connect-src`. While the
 * policy is Report-Only this works either way; the day it is enforced without
 * those entries, this widget dies and takes sign-in with it.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/**
 * Whether CAPTCHA is configured for this build.
 *
 * Call sites need this to tell two situations apart that both produce an
 * undefined token: "no site key, so no token is expected and the call should
 * proceed" and "a token was expected and we do not have one, so the call must
 * NOT be sent". Sending the second produces `captcha_failed` from Supabase and
 * a user staring at "the security check didn't pass" when the real state is
 * that the check has not finished.
 */
export const CAPTCHA_ENABLED = Boolean(SITE_KEY);
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** How long getToken() waits for a challenge to resolve before giving up.
 *  Managed mode is usually well under a second. Dropped from 20s to 8s: this
 *  is a person waiting on a button, and beyond a few seconds the honest answer
 *  is "the check has not completed" rather than a longer stare at a spinner. */
const TOKEN_TIMEOUT_MS = 8_000;

/**
 * Treat a token older than this as spent.
 *
 * Cloudflare expires tokens at 300s and fires `expired-callback` when it
 * happens -- but that callback is a timer, and browsers throttle timers hard
 * in background tabs. A form left open in another tab can therefore hold a
 * token Cloudflare already considers dead, with no callback having fired to
 * say so. Sending it gets `captcha_failed`, which the user reads as "my
 * password is being rejected for some security reason".
 *
 * 240s leaves a full minute of margin under Cloudflare's 300s.
 */
const TOKEN_MAX_AGE_MS = 240_000;

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
      theme?: "auto" | "light" | "dark";
      appearance?: "always" | "execute" | "interaction-only";
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** Module-level so five call sites across four screens share one <script>. */
let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    if (typeof document === "undefined") return reject(new Error("no document"));
    if (window.turnstile) return resolve();

    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Let a later mount retry rather than caching the failure forever --
      // this is usually a transient network problem or a blocked request,
      // and a permanently poisoned promise would mean the user has to
      // reload the whole page to get a working sign-in form back.
      scriptPromise = null;
      reject(new Error("Turnstile script failed to load"));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export interface TurnstileHandle {
  /**
   * The token to pass as `options.captchaToken`. Resolves `undefined` when
   * no site key is configured, which is what keeps local development and any
   * deploy predating the Supabase dashboard change working normally.
   */
  getToken: () => Promise<string | undefined>;
  /** Discard the current token and issue a fresh challenge. */
  reset: () => void;
}

/**
 * Renders the widget and hands the parent a token.
 *
 * TOKENS ARE SINGLE-USE AND EXPIRE. Supabase redeems the token on the call,
 * so a token that has been sent once is spent whether the call succeeded or
 * not -- and Turnstile expires an unused one after about five minutes. Both
 * cases produce `captcha_failed` on the next attempt, which would tell a user
 * with a mistyped password that the security check failed. Call sites must
 * therefore `reset()` after EVERY completed call, not only failed ones; the
 * expiry case is handled here by `expired-callback`.
 */
export const Turnstile = forwardRef<TurnstileHandle, { className?: string }>(
  function Turnstile({ className }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const tokenRef = useRef<string | null>(null);
    /** When tokenRef was set, for the staleness check in getToken(). */
    const tokenAtRef = useRef<number>(0);
    // Resolvers for getToken() calls made before a token exists.
    const waitersRef = useRef<Array<(token: string | undefined) => void>>([]);
    const [failed, setFailed] = useState(false);

    const settle = useCallback((token: string | undefined) => {
      tokenRef.current = token ?? null;
      tokenAtRef.current = token ? Date.now() : 0;
      waitersRef.current.splice(0).forEach((resolve) => resolve(token));
    }, []);

    useEffect(() => {
      if (!SITE_KEY) return;
      let cancelled = false;

      loadScript()
        .then(() => {
          if (cancelled || !containerRef.current || !window.turnstile) return;
          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: SITE_KEY,
            callback: (token) => {
              setFailed(false);
              settle(token);
            },
            "error-callback": () => {
              setFailed(true);
              // Release anyone waiting so the submit fails visibly instead of
              // hanging until the timeout.
              settle(undefined);
            },
            "expired-callback": () => {
              tokenRef.current = null;
              if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
            },
            theme: "auto",
          });
        })
        .catch(() => {
          if (!cancelled) {
            setFailed(true);
            settle(undefined);
          }
        });

      return () => {
        cancelled = true;
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        }
      };
    }, [settle]);

    useImperativeHandle(
      ref,
      () => ({
        getToken: () => {
          if (!SITE_KEY) return Promise.resolve(undefined);

          const fresh =
            tokenRef.current !== null && Date.now() - tokenAtRef.current < TOKEN_MAX_AGE_MS;
          if (fresh) return Promise.resolve(tokenRef.current ?? undefined);

          // Either there is no token yet, or the one we have is old enough
          // that Cloudflare may already have expired it. Discarding a
          // possibly-stale token and waiting for a fresh one costs a moment;
          // sending it costs the user a failed sign-in they cannot explain.
          if (tokenRef.current !== null && widgetIdRef.current && window.turnstile) {
            tokenRef.current = null;
            tokenAtRef.current = 0;
            window.turnstile.reset(widgetIdRef.current);
          }

          return new Promise<string | undefined>((resolve) => {
            let done = false;
            const finish = (token: string | undefined) => {
              if (done) return;
              done = true;
              resolve(token);
            };
            waitersRef.current.push(finish);
            setTimeout(() => finish(undefined), TOKEN_TIMEOUT_MS);
          });
        },
        reset: () => {
          tokenRef.current = null;
          tokenAtRef.current = 0;
          if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
        },
      }),
      [],
    );

    // Nothing to render, and nothing to say about it: an app deployed before
    // the site key is configured should look exactly as it does today.
    if (!SITE_KEY) return null;

    return (
      <div className={className}>
        <div ref={containerRef} />
        {failed && (
          // Not a FormError: this is not the outcome of a submit, and
          // role="alert" would interrupt a screen reader mid-form to announce
          // something the user has not acted on yet.
          <p className="mt-1 text-xs text-zinc-500">
            The security check couldn&apos;t load. Check your connection or any ad blocker, then
            reload.
          </p>
        )}
      </div>
    );
  },
);
