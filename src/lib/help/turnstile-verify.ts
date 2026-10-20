import "server-only";
import { TURNSTILE_TEST_SECRET } from "@/lib/env/turnstile-test-keys";

// Our own server-side check of a Cloudflare Turnstile token -- the "I am not
// a robot" box (help form, 2026-10-20). Sign-in never needed this: Supabase
// checks those tokens itself. The help form writes to our database, so the
// check has to happen here. Free; the same widget, with its secret key.
//
// https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 8_000;
/** Cloudflare refuses tokens older than 300s itself; this is the belt to that. */
const MAX_AGE_MS = 300_000;

export type CaptchaVerdict =
  | { ok: true }
  | { ok: false; reason: "missing" | "failed" | "wrong_site" | "wrong_action" | "stale" | "unavailable" | "not_configured" };

interface SiteverifyAnswer {
  success?: boolean;
  hostname?: string;
  action?: string;
  challenge_ts?: string;
  "error-codes"?: string[];
}

/**
 * The secret, or null when the check is off. Off only outside production:
 * there a missing secret (or Cloudflare's always-pass TEST secret) is a
 * misconfiguration, and the form must refuse rather than run unchecked.
 */
export function captchaSecret(): { secret: string; test: boolean } | null | "misconfigured" {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  const production = process.env.NODE_ENV === "production";
  if (!secret) return production ? "misconfigured" : null;
  const test = secret === TURNSTILE_TEST_SECRET;
  if (test && production) return "misconfigured";
  return { secret, test };
}

export async function verifyCaptcha(
  token: string | undefined,
  opts: { ip: string; action: string; hostname: string },
): Promise<CaptchaVerdict> {
  const config = captchaSecret();
  if (config === "misconfigured") return { ok: false, reason: "not_configured" };
  if (config === null) return { ok: true }; // development without keys
  if (!token) return { ok: false, reason: "missing" };

  const form = new URLSearchParams({ secret: config.secret, response: token });
  if (opts.ip && opts.ip !== "unknown") form.set("remoteip", opts.ip);

  let answer: SiteverifyAnswer;
  try {
    const res = await fetch(SITEVERIFY, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      redirect: "error",
    });
    if (!res.ok) return { ok: false, reason: "unavailable" };
    answer = (await res.json()) as SiteverifyAnswer;
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  if (answer.success !== true) return { ok: false, reason: "failed" };
  // Cloudflare's test secret answers for a dummy site and no action; only
  // its pass/fail means anything there (and it never runs in production).
  if (config.test) return { ok: true };
  if (answer.hostname !== opts.hostname) return { ok: false, reason: "wrong_site" };
  if (answer.action !== opts.action) return { ok: false, reason: "wrong_action" };
  const at = answer.challenge_ts ? Date.parse(answer.challenge_ts) : NaN;
  if (!Number.isFinite(at) || Date.now() - at > MAX_AGE_MS) return { ok: false, reason: "stale" };
  return { ok: true };
}
