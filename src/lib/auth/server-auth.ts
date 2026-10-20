import "server-only";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { z } from "zod";
import { clientIpKey, rateLimit } from "@/lib/rate-limit";
import { SESSION_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";

// Shared by the /api/auth/* routes (security gaps pass, Phase 1b): sign-in,
// sign-up and the rest moved from the browser to the server so the session
// cookie can be HttpOnly -- a script on the page, injected or not, can no
// longer read it.

/**
 * What a route answers on failure: Supabase's error CODE and status, never
 * its message (GoTrue's wording is for log readers and can carry detail).
 * The pages map it with authErrorMessage, exactly as they mapped the SDK's
 * error before, so every message -- including the ones that keep account
 * existence private -- reads the same as it did.
 */
export interface AuthErrorBody {
  code: string | null;
  status: number | null;
}

const CODE = /^[a-z0-9_]{1,64}$/;

export function authErrorBody(error: unknown): AuthErrorBody {
  const e = error as { code?: unknown; status?: unknown } | null;
  return {
    code: typeof e?.code === "string" && CODE.test(e.code) ? e.code : null,
    status: typeof e?.status === "number" && e.status >= 400 && e.status < 600 ? e.status : null,
  };
}

/** The response for a failed auth call. 4xx from Supabase stays 4xx; anything else is a 502. */
export function authFailure(error: unknown): Response {
  const body = authErrorBody(error);
  const status = body.status && body.status < 500 ? body.status : 502;
  return Response.json({ error: body }, { status });
}

export function badRequest(): Response {
  return Response.json({ error: { code: "validation_failed", status: 400 } }, { status: 400 });
}

// ---------------------------------------------------------------------------
// Our own limits. Once these calls come from our server, Supabase counts
// them all against the server's IP, so its per-IP limits become one bucket
// shared by every user (unless Sb-Forwarded-For is on, below). These stop one
// client from emptying it, and cap tries per address. CAPTCHA still applies.
// ---------------------------------------------------------------------------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const AUTH_LIMITS = {
  "sign-in": { ip: [30, 10 * MINUTE], email: [10, 10 * MINUTE] },
  "sign-up": { ip: [10, HOUR], email: [5, HOUR] },
  "forgot-password": { ip: [10, HOUR], email: [5, HOUR] },
  resend: { ip: [10, HOUR], email: [5, HOUR] },
  oauth: { ip: [30, 10 * MINUTE], email: null },
} as const satisfies Record<string, { ip: readonly [number, number]; email: readonly [number, number] | null }>;

export type AuthAction = keyof typeof AUTH_LIMITS;

/** Counters are keyed by a hash, so the rate-limit table never holds an address. */
export function emailKey(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32);
}

/**
 * Null when allowed, or a 429 in the same shape as Supabase's own rate-limit
 * error, so the page says "Too many attempts". The per-address limit answers
 * the same whether or not an account exists, so it reveals nothing.
 */
export async function enforceAuthLimits(action: AuthAction, request: Request, email?: string): Promise<Response | null> {
  const limits = AUTH_LIMITS[action];
  const checks: [string, number, number][] = [[`auth:${action}:ip:${clientIpKey(request.headers)}`, ...limits.ip]];
  if (email && limits.email) checks.push([`auth:${action}:email:${emailKey(email)}`, ...limits.email]);
  for (const [key, limit, windowMs] of checks) {
    const result = await rateLimit(key, limit, windowMs);
    if (!result.ok) {
      return Response.json(
        { error: { code: "over_request_rate_limit", status: 429 }, retryAfterSeconds: result.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
      );
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The Supabase client for auth calls, bound to this request's cookies.
// ---------------------------------------------------------------------------

/**
 * Supabase can rate-limit by the real user's IP when the server forwards it
 * in `Sb-Forwarded-For` -- but only on calls made with one of its new
 * SECRET keys (sb_secret_...), and only once forwarding is switched on in the
 * dashboard (https://supabase.com/docs/guides/auth/rate-limits). Off until
 * SUPABASE_AUTH_SECRET_KEY is set; our own limits above apply either way.
 *
 * Used for auth calls only. The secret key never reaches a .from() query:
 * those go through src/lib/supabase/server.ts with the anon key, as before.
 */
export function forwardedForEnabled(): boolean {
  return /^sb_secret_/.test(process.env.SUPABASE_AUTH_SECRET_KEY ?? "");
}

export async function authClient(request: Request) {
  const cookieStore = await cookies();
  const forward = forwardedForEnabled();
  const ip = clientIpKey(request.headers);
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    forward ? process.env.SUPABASE_AUTH_SECRET_KEY! : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: SESSION_COOKIE_OPTIONS,
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
      },
      ...(forward && ip !== "unknown" ? { global: { headers: { "sb-forwarded-for": ip } } } : {}),
    },
  );
}

/**
 * Where links in emails send people back to: this request's own origin, as
 * the browser's window.location.origin was before. Supabase only follows a
 * redirect on its exact allowlist (docs/security/supabase-auth-checklist.md),
 * so a forged Host header can't point a link anywhere else.
 */
export function siteOrigin(request: Request): string {
  return new URL(request.url).origin;
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export const emailField = z.string().trim().min(3).max(254).pipe(z.email());
/** Supabase sets the real rules (min 8); this only bounds the request. */
export const passwordField = z.string().min(1).max(1024);
export const captchaField = z.string().min(1).max(4096).optional();

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** Removes every Supabase session cookie on this request, whatever its chunking. */
export async function clearSessionCookies(): Promise<void> {
  const cookieStore = await cookies();
  for (const c of cookieStore.getAll()) {
    if (/^sb-.+-auth-token/.test(c.name)) cookieStore.set(c.name, "", { ...SESSION_COOKIE_OPTIONS, path: "/", maxAge: 0 });
  }
}
