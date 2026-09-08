import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { clientIpKey, enforceRateLimit } from "@/lib/rate-limit";

// Route handlers and Server Components used to each call `getUser()`
// themselves purely to read `user.id` and gate access -- a second real
// network round-trip to Supabase Auth on top of this one. Since this
// middleware already does the one verification that matters, it forwards
// the resolved id downstream via this header so nothing else has to ask
// again. See src/lib/supabase/auth.ts for the reading side.
const USER_ID_HEADER = "x-user-id";

// --- Content Security Policy -------------------------------------------
//
// The origins the *browser* is allowed to reach. Derived from the same env
// vars the clients are built from rather than hardcoded, so pointing the app
// at a different Supabase or Sentry project can't silently leave the policy
// naming the old one -- which in enforcing mode would break sign-in with a
// console error and nothing else to go on.
//
// Deliberately absent: api.openai.com, api.anthropic.com and the rest. Those
// are called from the server (src/lib/ai-keys/providers/*), never the
// browser -- that's the whole point of proxying them, so the user's API key
// never leaves the server. Same for query1.finance.yahoo.com. The provider
// links on /ask are `<a href>` navigations, which no fetch directive governs.
function safeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    // A Sentry DSN carries its public key as URL userinfo
    // (https://<key>@<host>/<project>); `.origin` drops it, leaving the host
    // the SDK actually POSTs envelopes to.
    return new URL(value).origin;
  } catch {
    return null;
  }
}

const SUPABASE_ORIGIN = safeOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
const SENTRY_ORIGIN = safeOrigin(process.env.NEXT_PUBLIC_SENTRY_DSN);

// Cloudflare Turnstile, the CAPTCHA on the four auth screens
// (src/components/turnstile.tsx). Hardcoded rather than derived from an env
// var like the two above: it is Cloudflare's fixed service origin, not a
// per-project URL, and the site key that IS per-project is not a URL to
// derive it from.
//
// **This is the CSP/CAPTCHA coupling, and getting it wrong locks users out.**
// The widget renders in an iframe from this origin and posts the challenge
// back to it, so `frame-src 'none'` -- which is what this policy said before
// CAPTCHA existed -- blocks the widget outright. While the policy is
// Report-Only that failure is invisible: the widget works and merely files a
// violation report. The day the header is flipped to enforcing, sign-in,
// sign-up and password reset all break at once. Never remove this while
// src/components/turnstile.tsx is in use.
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/**
 * Builds the policy for one request. The nonce must be fresh every time:
 * a predictable or reused nonce is worth exactly as much as
 * `'unsafe-inline'`, since an injected script need only carry the value.
 */
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";

  const connect = ["'self'", SUPABASE_ORIGIN, SENTRY_ORIGIN, TURNSTILE_ORIGIN]
    // Dev server HMR runs over a websocket; without this the policy breaks
    // fast refresh locally and nowhere else, which is a maddening way to
    // discover a header that is otherwise fine.
    .concat(isDev ? ["ws:", "wss:"] : [])
    .filter(Boolean)
    .join(" ");

  const img = ["'self'", "blob:", "data:", SUPABASE_ORIGIN].filter(Boolean).join(" ");

  return [
    "default-src 'self'",
    // `strict-dynamic` is what makes this policy worth having: it trusts
    // scripts loaded *by* an already-trusted (nonced) script, which is how
    // Next's bootstrap loads every chunk, while ignoring host allowlists --
    // so an attacker can't smuggle a script in via some permitted CDN.
    // 'unsafe-eval' is dev-only; React uses eval there to rebuild
    // server-side error stacks in the browser, and neither React nor Next
    // needs it in a production build.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // **'unsafe-inline', knowingly.** React renders the `style` prop as an
    // inline style attribute, and a nonce cannot cover style *attributes* --
    // only <style> elements. Framer Motion animates through that same prop on
    // essentially every transition, so a strict style-src would break the UI
    // wholesale. Note this must NOT also carry a nonce: a style-src with any
    // nonce in it causes browsers to ignore 'unsafe-inline' entirely, quietly
    // re-breaking everything this line exists to allow.
    //
    // The trade is a narrow one. CSS injection can restyle or deface a page;
    // it cannot execute script, which is what script-src above still forbids.
    "style-src 'self' 'unsafe-inline'",
    // next/font/google self-hosts its files at build time, so no
    // fonts.gstatic.com here -- there are no cross-origin font loads.
    "font-src 'self'",
    `img-src ${img}`,
    `connect-src ${connect}`,
    // Nothing embeds this app. frame-ancestors is the directive that actually
    // stops clickjacking; the X-Frame-Options header in next.config.ts is the
    // same rule restated for browsers too old to honour this one.
    //
    // (This app does now embed one thing -- see frame-src below. That is the
    // opposite direction and does not weaken this line.)
    "frame-ancestors 'none'",
    // Was 'none'. Turnstile is the only thing this app embeds, and it embeds
    // nothing else -- so this stays an allowlist of exactly one origin rather
    // than becoming 'self' or a wildcard. frame-ancestors above is unchanged
    // and still forbids anyone embedding US, which is the clickjacking half.
    `frame-src ${TURNSTILE_ORIGIN}`,
    "object-src 'none'",
    // Stops an injected <base> tag from re-pointing every relative script
    // URL on the page at an attacker's host.
    "base-uri 'self'",
    // Keeps an injected form from posting the user's journal off-site.
    "form-action 'self'",
    "worker-src 'self' blob:",
    "upgrade-insecure-requests",
    // WHERE VIOLATIONS GO. Both directives name the same collector
    // (src/app/api/csp-report/route.ts) because neither is supported
    // everywhere: `report-uri` is deprecated but is still the only one
    // Firefox and Safari implement, while `report-to` is the replacement
    // Chromium prefers. Sending only the modern one would mean hearing
    // nothing from Safari, whose CSP behaviour differs most.
    //
    // Browsers that support both send to `report-to` only, so this is not
    // double-reporting; the collector accepts either wire format regardless.
    "report-uri /api/csp-report",
    "report-to csp-endpoint",
  ].join("; ");
}

// --- Blanket API rate limit ------------------------------------------------
//
// **Why here and not in each route.** There are ~49 route handlers; eight of
// them carried their own limit and the other forty-one had none. Adding a
// hand-written limit to every one of those is forty-one chances to forget,
// and the next route added would be the forty-second. This runs before all of
// them, so a new route is covered the day it is written.
//
// The per-route limits still exist and still matter -- they are much tighter,
// and they are what actually protects the expensive handlers (OCR, AI,
// imports). This is the floor underneath them, not a replacement.
//
// **Scoped to /api/ deliberately.** The matcher below also covers page
// navigations and Next's own RSC payload requests, and a single page load can
// fire a dozen of those. Rate limiting them would break ordinary browsing,
// which is the exact failure the brief warns against.
//
// **Generous on purpose.** Autosave alone can issue a PATCH every 600ms while
// someone types, and the trade page fans out to several endpoints at once, so
// the ceiling has to sit well above sustained real use. 300/min bounds a
// runaway loop without ever being reachable by a person using the app.
//
// Same per-instance caveat as everything else built on src/lib/rate-limit.ts:
// serverless instances do not share memory, so this bounds abuse per warm
// instance rather than globally. See SECURITY.md.
const API_RATE_LIMIT = 300;
const API_RATE_WINDOW_MS = 60_000;

// Unauthenticated callers get a much smaller budget: nothing legitimate hits
// this app's API without a session (every handler 401s), so sustained
// unauthenticated traffic is either a probe or a misconfigured client.
//
// Note this does NOT save the Supabase getUser() round-trip below -- the check
// runs after it, because whether a caller is authenticated is what decides
// which key to limit them by. Skipping that call for requests carrying no auth
// cookie at all would avoid it, and is worth doing if anonymous traffic ever
// becomes a real cost; it is not the problem this limit exists to solve.
const ANON_API_RATE_LIMIT = 60;

export async function proxy(request: NextRequest) {
  // getUser() can trigger a token refresh mid-call, which needs new cookies
  // written to both the outgoing request (so this same request sees them)
  // and the response (so the browser does). Collected here instead of
  // applied immediately, because the final response can only be built once
  // the user id is known -- building it earlier and reconstructing it after
  // would drop these.
  const pendingCookies: { name: string; value: string; options: CookieOptions }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          pendingCookies.push(...cookiesToSet);
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();

  // Never trust a client-supplied value for this header -- start from the
  // incoming headers, strip whatever's there, then set it ourselves only
  // once getUser() has actually verified the session.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(USER_ID_HEADER);
  if (data.user) requestHeaders.set(USER_ID_HEADER, data.user.id);

  // Applied after getUser() so an authenticated caller is limited by user id
  // rather than by IP -- otherwise everyone behind one office NAT or mobile
  // carrier gateway shares a single bucket and throttles each other.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const limited = data.user
      ? enforceRateLimit(`api:${data.user.id}`, API_RATE_LIMIT, API_RATE_WINDOW_MS)
      : enforceRateLimit(
          `api-anon:${clientIpKey(request.headers)}`,
          ANON_API_RATE_LIMIT,
          API_RATE_WINDOW_MS,
          "Too many requests. Wait a minute and try again.",
        );
    if (limited) return limited;
  }

  const nonce = crypto.randomUUID();
  const csp = buildCsp(nonce);

  // The two headers below are set on the *request*, which never reaches the
  // browser -- they exist so the server-side render can see them:
  //
  //  - `content-security-policy` (the enforcing name) is what Next parses to
  //    find `'nonce-...'` and stamp onto every framework and chunk <script>
  //    it emits. It only looks for the enforcing name, so setting just the
  //    report-only header here would mean no nonces on Next's own scripts --
  //    and a report-only rollout that reports nothing but false positives,
  //    telling us nothing about whether the policy is safe to enforce.
  //  - `x-nonce` is for our own components; see layout.tsx, which hands it to
  //    next-themes so its anti-flash inline script is nonced too.
  requestHeaders.set("content-security-policy", csp);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  pendingCookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));

  // **Report-Only on the way out, deliberately.** Every nonce is real and
  // every directive is the one we intend to enforce, but a violation is
  // reported to the console instead of blocking. That makes this deployable
  // with no risk of a missed origin taking out sign-in or the price charts in
  // production. Watch the browser console for a few days of real use, then
  // rename this single header to `Content-Security-Policy` to turn it on.
  response.headers.set("Content-Security-Policy-Report-Only", csp);

  // Defines the `csp-endpoint` group that `report-to` above refers to.
  // Without this header that directive names a group the browser has never
  // heard of and is silently ignored -- the policy would look like it
  // reports and would not. `report-uri` needs nothing here; it carries its
  // own URL.
  //
  // Absolute rather than relative: the Reporting API resolves endpoint URLs
  // against the document, and a report generated inside a worker or a
  // sandboxed context does not always have the base URL you would expect.
  response.headers.set(
    "Reporting-Endpoints",
    `csp-endpoint="${request.nextUrl.origin}/api/csp-report"`,
  );

  return response;
}

export const config = {
  matcher: [
    // api/cron/ (trailing slash) is excluded: those routes authenticate with
    // their own bearer secret (no cookie session to refresh), so routing
    // them through here just added a wasted Supabase auth round-trip to
    // every scheduled run. The slash matters -- without it this is a bare
    // prefix match that would also swallow any future cookie-authenticated
    // route merely starting with those characters (e.g. /api/cron-report),
    // silently denying it x-user-id and 401ing every request forever.
    "/((?!_next/static|_next/image|favicon.ico|api/cron/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
