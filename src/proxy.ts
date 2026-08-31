import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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

/**
 * Builds the policy for one request. The nonce must be fresh every time:
 * a predictable or reused nonce is worth exactly as much as
 * `'unsafe-inline'`, since an injected script need only carry the value.
 */
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";

  const connect = ["'self'", SUPABASE_ORIGIN, SENTRY_ORIGIN]
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
    // Nothing embeds this app and this app embeds nothing. frame-ancestors
    // is the directive that actually stops clickjacking; the
    // X-Frame-Options header in next.config.ts is the same rule restated for
    // browsers too old to honour this one.
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    // Stops an injected <base> tag from re-pointing every relative script
    // URL on the page at an attacker's host.
    "base-uri 'self'",
    // Keeps an injected form from posting the user's journal off-site.
    "form-action 'self'",
    "worker-src 'self' blob:",
    "upgrade-insecure-requests",
  ].join("; ");
}

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
