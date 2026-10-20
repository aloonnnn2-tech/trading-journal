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
 * therefore allow that origin in `frame-src` and `connect-src`. The policy is
 * enforced (since 2026-09-14), so without those entries this widget dies and
 * takes sign-in with it.
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

/**
 * The longest getToken() waits while the check is still loading or working.
 *
 * It used to give up after a fixed 8s and the page said "complete the
 * security check below" -- on a slow connection the box hadn't even appeared
 * yet, so there was nothing below to complete (Alon, 2026-10-07: on his PC
 * the box took 10-17s to show). Now getToken() returns at once when the check
 * has an answer -- a token, a failure, or "needs a tick" -- and only waits
 * while it genuinely is still working, up to this ceiling.
 */
const TOKEN_TIMEOUT_MS = 45_000;

/**
 * If the box hasn't appeared by now, something in the browser is blocking it
 * (an ad/tracker blocker such as Opera GX's or uBlock, a privacy setting).
 * Cloudflare then calls none of its callbacks, so without this the page
 * waited in silence -- "stuck" (Alon, 2026-10-07: a fresh Chrome profile on
 * his PC showed the box in ~6s; his own browser never did).
 */
const NOT_SHOWN_MS = 12_000;

/** A computer clock further off than this breaks the check; say so. */
const CLOCK_SKEW_WARN_MS = 120_000;

/**
 * Where the check is, so a page can tell the user what to do instead of one
 * fixed sentence. "interactive": the box is showing and waits for a tick.
 */
export type CaptchaStatus = "loading" | "working" | "interactive" | "passed" | "failed";

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
      "error-callback"?: (code: string) => boolean | void;
      "expired-callback"?: () => void;
      "timeout-callback"?: () => void;
      "unsupported-callback"?: () => void;
      "before-interactive-callback"?: () => void;
      "after-interactive-callback"?: () => void;
      theme?: "auto" | "light" | "dark";
      appearance?: "always" | "execute" | "interaction-only";
      /** Bound into the token; our own server check compares it (the help form). */
      action?: string;
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
  /**
   * Why there is no token, in words for the user, after getToken() resolved
   * undefined: still loading, needs a tick, or failed (with Cloudflare's
   * error code, and the computer's clock when that is the likely cause).
   */
  problem: () => string;
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
export const Turnstile = forwardRef<TurnstileHandle, { className?: string; action?: string }>(
  function Turnstile({ className, action }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const tokenRef = useRef<string | null>(null);
    /** When tokenRef was set, for the staleness check in getToken(). */
    const tokenAtRef = useRef<number>(0);
    // Resolvers for getToken() calls made before a token exists.
    const waitersRef = useRef<Array<(token: string | undefined) => void>>([]);
    const [status, setStatusState] = useState<CaptchaStatus>("loading");
    const statusRef = useRef<CaptchaStatus>("loading");
    const [errorCode, setErrorCode] = useState<string | null>(null);
    const errorCodeRef = useRef<string | null>(null);
    // How far this computer's clock is from the server's, once measured.
    const [clockSkewMs, setClockSkewMs] = useState<number | null>(null);
    const clockSkewRef = useRef<number | null>(null);
    const failed = status === "failed";

    const setStatus = useCallback((next: CaptchaStatus) => {
      statusRef.current = next;
      setStatusState(next);
    }, []);

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
            ...(action ? { action } : {}),
            callback: (token) => {
              setStatus("passed");
              errorCodeRef.current = null;
              setErrorCode(null);
              settle(token);
            },
            "error-callback": (code) => {
              // Cloudflare's own code says why (docs: "Turnstile error
              // codes"). Shown with the message, so a user -- or we -- can
              // look it up instead of guessing.
              errorCodeRef.current = code ? String(code) : null;
              setErrorCode(errorCodeRef.current);
              setStatus("failed");
              // Release anyone waiting so the submit fails visibly instead of
              // hanging until the timeout.
              settle(undefined);
            },
            "unsupported-callback": () => {
              errorCodeRef.current = "unsupported browser";
              setErrorCode(errorCodeRef.current);
              setStatus("failed");
              settle(undefined);
            },
            // The box is showing and waits for a tick: tell a waiting submit
            // now rather than let it sit there.
            "before-interactive-callback": () => {
              setStatus("interactive");
              settle(undefined);
            },
            "after-interactive-callback": () => setStatus("working"),
            "timeout-callback": () => {
              // The tick wasn't given in time; start over.
              setStatus("loading");
              if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
            },
            "expired-callback": () => {
              tokenRef.current = null;
              setStatus("loading");
              if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
            },
            theme: "auto",
          });
        })
        .catch(() => {
          if (!cancelled) {
            errorCodeRef.current = null;
            setStatus("failed");
            settle(undefined);
          }
        });

      // The box is an iframe inside the container; a container still empty
      // after NOT_SHOWN_MS means it is being blocked, not slow.
      const notShown = setTimeout(() => {
        if (cancelled || statusRef.current !== "loading") return;
        const box = containerRef.current?.getBoundingClientRect();
        if (box && box.height >= 20) return;
        errorCodeRef.current = NOT_SHOWN;
        setErrorCode(NOT_SHOWN);
        setStatus("failed");
        settle(undefined);
      }, NOT_SHOWN_MS);

      // A computer clock that is minutes off makes the check fail (found on
      // Alon's PC, 4 minutes fast). Measured once against the server's Date
      // header -- same origin, so readable -- and only reported when wrong.
      fetch(window.location.origin + "/favicon.ico", { method: "HEAD", cache: "no-store" })
        .then((res) => {
          const server = Date.parse(res.headers.get("date") ?? "");
          if (cancelled || Number.isNaN(server)) return;
          clockSkewRef.current = Date.now() - server;
          setClockSkewMs(clockSkewRef.current);
        })
        .catch(() => {});

      return () => {
        cancelled = true;
        clearTimeout(notShown);
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        }
      };
    }, [settle, setStatus, action]);

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
            setStatus("loading");
            window.turnstile.reset(widgetIdRef.current);
          }

          // Nothing to wait for: it failed, or it is waiting on the user.
          if (statusRef.current === "failed" || statusRef.current === "interactive") {
            return Promise.resolve(undefined);
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
          if (widgetIdRef.current && window.turnstile) {
            setStatus("loading");
            window.turnstile.reset(widgetIdRef.current);
          }
        },
        problem: () => {
          const s = statusRef.current;
          if (s === "interactive") return "Tick \u201cVerify you are human\u201d below, then try again.";
          // The note under the check says why (and keeps saying it as that
          // changes); the form error just points at it, so the two never disagree.
          if (s === "failed") return "The security check didn’t work. See the note under it.";
          return "The security check is still loading. Give it a moment, then try again.";
        },
      }),
      [setStatus],
    );

    // Nothing to render, and nothing to say about it: an app deployed before
    // the site key is configured should look exactly as it does today.
    if (!SITE_KEY) return null;

    return (
      <div className={className}>
        <div ref={containerRef} />
        {status === "loading" && !failed && (
          <p className="mt-1 text-xs text-zinc-500" aria-live="polite">
            Loading the security check…
          </p>
        )}
        {failed ? (
          // Not a FormError: this is not the outcome of a submit, and
          // role="alert" would interrupt a screen reader mid-form to announce
          // something the user has not acted on yet.
          <p className="mt-1 text-xs text-zinc-500">{failureText(errorCode, clockSkewMs)}</p>
        ) : (
          clockSkewMs !== null &&
          Math.abs(clockSkewMs) > CLOCK_SKEW_WARN_MS && (
            <p className="mt-1 text-xs text-zinc-500">{clockText(clockSkewMs)}</p>
          )
        )}
      </div>
    );
  },
);

function clockText(skewMs: number): string {
  const minutes = Math.max(1, Math.round(Math.abs(skewMs) / 60_000));
  return `Your computer's clock is about ${minutes} minute${minutes === 1 ? "" : "s"} ${skewMs > 0 ? "fast" : "slow"}, which stops the security check working. Turn on automatic time in your system settings, then reload.`;
}

const NOT_SHOWN = "not-shown";

/** The "couldn't load" sentence, with Cloudflare's code and the clock when relevant. */
function failureText(code: string | null, skewMs: number | null): string {
  if (skewMs !== null && Math.abs(skewMs) > CLOCK_SKEW_WARN_MS) return clockText(skewMs);
  if (code === NOT_SHOWN) {
    return "The security check isn't appearing in this browser. An ad or tracker blocker, or a privacy setting, is probably blocking challenges.cloudflare.com. Allow it, or try another browser, then reload.";
  }
  const suffix = code ? ` (Cloudflare error ${code})` : "";
  return `The security check couldn't load${suffix}. Check your connection or any ad blocker, then reload.`;
}
