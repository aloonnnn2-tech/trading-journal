# Security notes — Trading Lens

Operational security posture, and the things that live outside this repo and so
cannot be fixed by changing code. Written September 2026 during the security,
accessibility and compliance pass.

---

## 1. Auth rate limiting lives in the Supabase dashboard, not in this codebase

**This is the important one.**

Sign-in, sign-up, password reset and the confirmation resend all call Supabase
Auth **directly from the browser**:

```
src/app/sign-in/page.tsx        supabase.auth.signInWithPassword()
src/app/sign-up/page.tsx        supabase.auth.signUp() / .resend()
src/app/forgot-password/page.tsx supabase.auth.resetPasswordForEmail()
src/app/reset-password/page.tsx  supabase.auth.updateUser()
```

Those requests go from the user's browser to
`https://<project>.supabase.co/auth/v1/...`. They do **not** pass through
`src/proxy.ts`, and they do not touch any route handler in `src/app/api/`.
There is therefore **nowhere in this repository that an auth rate limit could
be enforced**. Any code added here to "rate limit login" would be limiting a
function the attacker simply would not call.

The protections that do work are all configured in the Supabase dashboard:

### Apply these settings

**Authentication → Rate Limits**

| Limit | Suggested | Why |
| --- | --- | --- |
| Sign-in / token grants (per IP, 5 min) | 30 | Well above a person mistyping a password; far below a credential-stuffing run. |
| Sign-ups (per IP, hour) | 10 | This is a single-user journal, not a service people register on in bulk. |
| Password recovery emails (per hour) | 10 | Also caps using the app as a mail relay to harass an address. |
| Confirmation / magic-link emails (per hour) | 10 | Same. |
| Token refreshes (per 5 min) | default | Leave alone; too tight logs active users out. |
| Verification attempts (per 5 min) | 30 | Bounds OTP brute-forcing. |

**Authentication → Attack Protection**

- **CAPTCHA: done.** Cloudflare Turnstile has been live since 2026-09-08 on
  sign-in, sign-up and forgot-password (`src/components/turnstile.tsx`); the
  screens pass the token as `options.captchaToken`, and Supabase rejects auth
  calls without one. This is the most effective control here, because it
  applies at Supabase's edge, where the requests actually land.
- **Leaked-password protection** (Have I Been Pwned): blocked by the plan
  tier, see `SECURITY-RUNBOOK.md` §2. The minimum length is now 8.

**Consider also**

- Raising the minimum password length above 6 (Supabase enforces this
  server-side; the client `minLength` attributes in the auth pages should be
  updated to match, or users get a server error where a form hint belongs).
- Whether to keep email confirmation on. `src/app/auth/confirm/route.ts` says
  sign-up no longer requires confirmation while `src/app/sign-up/page.tsx`
  still handles the awaiting-confirmation path; whichever is intended, the
  other should follow.

### "5 attempts per 15 minutes" (hardening brief, 2026-10-09)

The brief asks for at most 5 login attempts per 15 minutes, per IP **and** per
account. Supabase's auth limits are per IP only, over a 5-minute window, so
neither half can be expressed exactly:

- **Per IP:** the runbook sets sign-in to 5 per 5 minutes, which is the
  closest setting (up to 15 per 15 minutes). Going lower locks out someone
  who mistypes a password twice. Every attempt also needs a fresh Turnstile
  token, which is what actually stops a script.
- **Per account:** not possible without proxying auth through our own routes,
  which this file's §8 records as deliberately not done. Alon confirmed that
  choice on 2026-10-09. It is listed as an open item in
  `docs/security/99-audit-report.md`.

### What the app does do

`src/lib/auth/error-messages.ts` maps Supabase's rate-limit codes
(`over_request_rate_limit`, `over_email_send_rate_limit`) to messages that tell
the user to wait rather than showing GoTrue's own wording. So when the limits
above trigger, the UI already handles it properly.

---

## 2. Application rate limiting

Two layers, both built on `src/lib/rate-limit.ts`.

**Blanket limit — `src/proxy.ts`.** Every request to `/api/*` is limited:
300/min per user id when authenticated, 60/min per client IP when not. Scoped
to `/api/` deliberately — the proxy matcher also covers page navigations and
Next's RSC payload requests, and limiting those would break normal browsing.

**Per-route limits.** Tighter budgets on the handlers where one request is
genuinely expensive or destructive:

| Route | Limit | Reason |
| --- | --- | --- |
| `POST /api/ocr/parse` | 20/min | CPU-bound native OCR, 60s budget |
| `POST /api/chat/conversations/[id]/turn` | 60/min turns, 20/min new messages | Third-party API call on the user's key; one model round per request |
| `POST /api/chat/conversations` | 30/min | Resolves a stored key |
| `POST /api/ai-reviews/*` | see route | Third-party API call on the user's key |
| `POST /api/trades` | 60/min | Row creation |
| `PATCH /api/trades/[id]` | 240/min | **Autosave** — deliberately loose |
| `DELETE /api/trades/[id]` | 60/min | Destructive |
| `POST /api/trades/[id]/images` | 30/min | 5 MB decode + re-encode via sharp |
| `POST /api/trades/import` | 10/min | Up to 20k rows, batched inserts |
| `POST /api/trades/import-json` | 10/min | Same |
| `POST /api/trades/import/parse-xlsx` | 20/min | Zip + sheet walk, memory-heavy |
| `GET /api/trades/export` | 20/min | Serialises the whole account |
| `DELETE /api/account/delete` | 5/hour | Irreversible, partially-completing |
| `POST /api/admin/plan` | 60/min | Limits a leaked admin session |

**Daily caps — `src/lib/rate-limits/daily.ts`** (2026-10-09). The per-minute
limits stop a burst. A script making one call every few seconds all day stays
under every one of them and still runs up the bill, so the expensive routes
also carry a per-user daily cap. All the caps are in one table and sit far
above a person's real use: 200 screenshot reads, 100 AI reviews, 500 Ask
messages, 100 imports, 200 exports, 50 excursion recalculations and 3,000
price lookups per day.

**Yahoo ceiling.** The market-data routes also share one app-wide bucket of
600 calls a minute (`upstream:yahoo`). The unofficial endpoint can block this
server's IP for everyone, so this bounds the app as a whole, not just one
account.

**Request size — `src/lib/http/body-limits.ts`.** The proxy refuses (413) any
non-GET `/api` request whose `Content-Length` is over 1 MB, or over 6 MB for
the upload and import routes, before a handler buffers it.

**Why the remaining routes have no individual limit.** Settings, folders,
strategies, goals, field definitions and commission rules are all
authenticated, owner-scoped by RLS, and cheap — a single small row write. The
blanket proxy limit covers them. This is the documented reason the brief asks
for, not an oversight.

### Global, via a Postgres counter

`src/lib/rate-limit.ts` records each hit through a shared Postgres counter
(`rate_limit_hit`, migration `0042_rate_limit_counters.sql`), so the ceiling
holds across every serverless instance rather than per warm instance — a
distributed client no longer gets a multiplied limit, and a cold start no
longer resets the window. The counter is written only by a `security definer`
function granted to `service_role`, called with the service-role key; it is
**never** granted to `anon`/`authenticated`, because the anon key is public and
a caller could otherwise exhaust another user's bucket by naming it.

**It fails open.** If the function is missing (migration not applied) or the
database is briefly unreachable, requests are allowed rather than blocked — a
limiter that 429s everyone during a DB blip is worse than none. The cost is one
DB round-trip per `/api/` request, on top of the auth check the proxy already
does; accepted deliberately. If that latency ever bites, the global check can
be narrowed to the expensive/destructive routes and the blanket floor left
in-memory.

---

## 3. Content Security Policy — enforced

`src/proxy.ts` builds a full CSP with a per-request nonce and `strict-dynamic`,
and sends it as `Content-Security-Policy` (enforcing). An injected script with
no valid nonce is blocked, not merely reported. The `report-uri`/`report-to`
directives remain in the policy, so violations still flow to `/api/csp-report`
for monitoring even while enforcing.

**Reversible without a deploy.** Set the env var `CSP_REPORT_ONLY=true` (e.g.
in the Netlify dashboard) to fall back to `Content-Security-Policy-Report-Only`.
Every directive and nonce is identical between the two modes — only whether a
violation blocks or reports changes — so if a missed origin ever surfaces in
production the policy can be softened in seconds and re-enforced once fixed,
with no code change.

Known deliberate weakness: `style-src` carries `'unsafe-inline'`, because React
renders the `style` prop as an inline style attribute and a nonce cannot cover
style *attributes*. Framer Motion animates through that prop constantly. CSS
injection can deface a page; it cannot execute script, which `script-src` still
forbids.

---

## 4. Cookie consent assessment

**Current reading: no consent banner appears to be required.** Recorded here
with reasoning so it can be re-checked when something changes.

What the app stores is enumerated in `src/app/cookies/page.tsx`, which was
written by tracing each item to the line that sets it. In summary:

- **Cookies:** Supabase auth session only. Strictly necessary — without it the
  user cannot stay signed in.
- **localStorage / sessionStorage:** theme, timezone-sync flag, chart symbol
  override, analytics session id. All first-party, all either functional or a
  preference the user set themselves.
- **Analytics:** first-party, own Postgres table, signed-in users only, and
  disabled outright on public pages (`src/lib/public-paths.ts`). No Google
  Analytics, no advertising pixels, no cross-site tracking, no third-party
  profiling.
- **Sentry:** third-party error monitoring, active on public pages too. Sets no
  cookies; session replay is off (`replaysSessionSampleRate: 0`). It does
  receive IP addresses, so it is a GDPR processor even though it is not an
  ePrivacy cookie concern.

Under the ePrivacy Directive, consent is required for storing or accessing
information on a user's device unless it is strictly necessary or explicitly
requested by the user. Everything above falls into those exemptions.

**This is an engineering assessment, not legal advice.** It should be reviewed
by a lawyer before being relied upon, particularly for EU/EEA/UK users.

**Re-open this question if any of these happen:**

- Any third-party analytics, advertising, A/B testing or heatmap tool is added.
- Sentry session replay is switched on (it records the screen).
- Marketing or conversion pixels are added to the landing page.
- Analytics that *identifies* a logged-out visitor starts running on public
  pages — a visitor id, a cookie, a fingerprint, anything that lets two visits
  be tied to one person. **The anonymous homepage-view tally added in
  September 2026 is deliberately not this**: `record_public_view` (migration
  0043) increments one integer per day and path, and the beacon that calls it
  (`src/components/public-view-beacon.tsx`) sets no cookie and touches no
  browser storage. Nothing is stored on or read from the device, and nothing
  can be linked to a person, so it stays outside the ePrivacy consent
  requirement. The moment that counter grows an identifier, this trigger fires.
  (Since 0068, 2026-10-12, only the server may call `record_public_view`, and
  the route limits each IP to 60 views an hour. The IP is a short-lived
  rate-limit bucket key, the same as the proxy's limit for every anonymous
  API call, and is never stored with the count.)
- Per-account analytics now also record which buttons a signed-in user
  presses (click autocapture, `src/lib/tracking/click-capture.ts`). This is
  still first-party, signed-in-only, and the label rule there keeps trade
  content out of the recorded label — so it does not change the banner
  assessment, but the privacy and cookies pages now state it plainly.
- A Data Processing Agreement with Sentry and Supabase has not been signed —
  that is required regardless of the banner question.

---

## 4b. The session cookie is HttpOnly (security gaps pass, Phase 1b)

The browser never talks to Supabase. Sign-in, sign-up, sign-out, password
reset, resend and "Continue with Google" are server routes
(`src/app/api/auth/*`, shared code in `src/lib/auth/server-auth.ts`), so
the session cookie is written `HttpOnly; SameSite=Lax; Secure` and no script
on the page can read it. `src/lib/supabase/no-browser-client.test.ts` fails
if a browser Supabase client comes back.

- **Limits:** these calls now reach Supabase from our server's IP, so its
  per-IP auth limits would be one bucket for everyone. The routes add their
  own, per visitor IP and per address (the address is hashed in the
  counter). CAPTCHA tokens are passed through as before.
- **Optional:** with one of Supabase's new secret keys in
  `SUPABASE_AUTH_SECRET_KEY` (and forwarding switched on in the dashboard),
  the routes send the visitor's IP as `Sb-Forwarded-For`, so Supabase's own
  limits count real visitors again.
- **Kill switch:** `AUTH_COOKIE_HTTPONLY=false` writes the cookie
  script-readable again without a code change. Sign-in works either way.
- **What it doesn't stop:** a script injected into an open page can still
  call this app's API as that user while the page is open. It just can't
  carry the session away. The CSP is still the control for that.

## 4c. The Get help form (signed-out writes)

`/help` and `POST /api/help` (2026-10-20) are the one place a visitor with
no account writes to our database, so the form is built to be spammed:

- **Robot check, for everyone**, verified by our own server with Cloudflare
  (`src/lib/help/turnstile-verify.ts`; secret `TURNSTILE_SECRET_KEY`). It
  checks pass, hostname, the `help` action and age. In production a
  missing secret, or Cloudflare's always-pass test secret, refuses the form
  (fails closed).
- **Limits** before the check: 5/hour per IP, 3/hour per address (hashed),
  10/day per account, **200/day for the whole site**.
- **A honeypot field**: a filled one is answered "sent" and stored nowhere.
- **The table** (`help_requests`, 0075): service role only, no RLS
  policies, grants revoked, a size check on every column, a 20,000-row
  ceiling. `user_id` comes only from the verified session.
- **Admin side** (`/admin/help`, `/api/admin/help`): admin gate, a fixed
  path with the id in the body, audited. Messages render as text, never
  HTML.

It can't be used to get into an account: it reads nothing back and changes
no account. The worst a determined bot gets is 200 junk rows a day.

## 4d. Deleting an account takes the inbox

Since 2026-10-20, deleting an account is two steps:

1. `POST /api/account/delete/request` records a one-hour request (0076)
   and has Supabase email a link (the "Magic link" template,
   `docs/security/delete-account-email.md`) to the account's own address.
2. The link ends in a one-time code that only that email holds
   (`/account/delete/confirm/<code>`; only its SHA-256 is stored, 0077), and
   that page offers the button.

`DELETE /api/account/delete` refuses (403) unless the code matches the
signed-in account's request, which is looked up by the verified user id,
never by the code, and the request is under an hour old
(`src/lib/account/deletion-proof.ts`).

A stolen session or an injected script can start a deletion but can't
finish one, because the code never reaches the browser. The link works in
any browser; opening it deletes nothing.

## 5. File upload posture

Already sound before this pass; recorded so it is not weakened by accident.

- MIME allowlist: JPEG, PNG, WebP, GIF. **SVG is excluded deliberately** — an
  SVG can carry `<script>`, and signed URLs are opened directly in the browser,
  which would make it stored XSS.
- 4 MB cap (`src/lib/http/upload-limits.ts`), plus a 50-megapixel ceiling so
  a decompression bomb cannot land during decode. Per account: 2,000 files,
  200 MB and 100 uploads a day (`src/lib/limits.ts`, security gaps pass).
- Every upload is re-encoded through sharp. This both strips EXIF (phone photos
  of trading screens routinely carry GPS coordinates) and proves the bytes
  really are the image type the client claimed.
- **Storage keys never use the client filename.** The path is
  `{userId}/{tradeId}/{uuid}.{ext}` with the extension derived from the
  validated MIME type — so path traversal, collisions and executable
  extensions are all structurally impossible, not filtered against.
- Bucket `trade-images` is private. Users can read and delete their own
  files (`0012`), but **cannot write to it directly** since 0073: an upload
  through the Storage API skipped every check on this list (G-2). The upload
  route writes with the service role instead. Files are served via
  short-lived signed URLs.
- **Service-role routes and dynamic segments.** The rule: no service-role
  query may be keyed by an id from the URL, because the service role skips
  RLS, so a URL id would reach any user's row. `account/export` sits at a
  fixed path for that reason. The **one exception** is
  `POST /api/trades/[id]/images`. The `[id]` is used only after the user's
  own RLS client has returned that trade (`getTrade`), and the service role
  only writes a Storage path built from the verified user id
  (`{userId}/{tradeId}/…`). Uploading to another user's trade is covered by
  `tests/idor/routes.idor.test.ts`. Any new exception needs the same two
  conditions and a cross-user test.
- `X-Content-Type-Options: nosniff` is set globally, so a stored file cannot be
  sniffed into `text/html` and executed on this origin.

The dangerous-extension list in the brief (`.php`, `.exe`, `.svg`, …) is
handled by the allowlist being an allowlist: nothing outside those four MIME
types is accepted, and the stored extension is never taken from user input.

---

## 6. Provider API keys: what a breach would actually yield

Users bring their own AI provider keys. Those are spendable credentials
belonging to someone else's account, so they get treated as the most sensitive
thing in the database.

### If the database is breached

**Nothing usable.** `user_api_keys.encrypted_key` holds AES-256-GCM ciphertext.
The secret that decrypts it (`AI_KEY_ENCRYPTION_SECRET`) lives in the process
environment and is never written to the database, so a dump — leaked backup,
stolen read replica, SQL injection, a misconfigured RLS policy — yields
ciphertext and a four-character masked suffix. The suffix is four characters of
a 40+ character secret and does not narrow a brute force.

### If someone gets database *write* access

Also nothing usable, and this part changed in this pass. Ciphertext is bound to
its owner's user id as GCM additional authenticated data, so a value lifted out
of one row and written into another fails to decrypt.

Before that binding existed, an attacker who could write to the table could
copy a victim's `encrypted_key` into their own row and then use the AI features
normally — the server would decrypt the victim's key and spend it. They could
not *read* the key, but they could run up the bill on it indefinitely. That
needed no encryption secret at all. `verify:ai-secret` now asserts the binding
holds, and `crypto.test.ts` covers it directly.

The unbound `v1` format, kept for a while so keys stored before the binding
kept working, is **refused** since 2026-09-21: no v1 row remained, and
accepting the format was only a door for exactly this attack.

Since 2026-09-30 the binding is tighter, in two layers:

- **The `v3` format** binds each ciphertext to its owner, **its own row id and
  its provider**. Swapping ciphertext between two of a user's own rows, or
  changing a row's `provider` so the key is sent to a different company's
  servers, now makes it undecryptable instead of silently working. `v2` still
  reads; it is rewritten as `v3` on next use, or all at once with
  `npm run rotate:ai-keys`. Writing `v3` is switched on by
  `AI_KEY_WRITE_V3=true` (SECURITY-RUNBOOK.md §6), because code already
  deployed can't read it.
- **Migration 0058** takes the table away from the user's own session. A
  signed-in user (or anyone holding their session, or an XSS) can see a key's
  public columns and change only its label and on/off state. Reading the
  ciphertext, storing a key and changing its model go through
  `src/lib/ai-keys/vault.ts` only: the service role, always filtered by the
  verified user id. A unit test fails if any other file names
  `encrypted_key`.

### If the encryption secret itself leaks

Recoverable, provided it is noticed. Rotation is supported:

1. Generate a new secret: `openssl rand -base64 32`
2. Set `AI_KEY_ENCRYPTION_SECRET` to the new value
3. Set `AI_KEY_ENCRYPTION_SECRET_PREVIOUS` to the old one (comma-separate to
   retire several generations at once)
4. Deploy, then run `npm run verify:ai-secret` to confirm both are readable

Stored keys keep working immediately and are re-encrypted under the new secret
the next time each one is used. To finish at once rather than waiting on idle
keys, run `npm run rotate:ai-keys` (a dry run) and then
`npm run rotate:ai-keys -- --apply`; it prints counts and row ids only. Then
drop `AI_KEY_ENCRYPTION_SECRET_PREVIOUS`.

Before this, a leaked secret meant permanent compromise: there was no way to
change it that did not require every user to re-paste their key.

Rotating does **not** undo a leak that has already been exploited. If the
secret is known to have leaked, tell users to revoke and reissue their provider
keys — rotation protects the ciphertext going forward, not keys an attacker
already decrypted.

### Keys in logs, error reports and caches

- **The decrypted key is not a string.** It is a `SecretKey` (`secret.ts`):
  printing it, `JSON.stringify`-ing it, or capturing it in an error shows
  `[redacted]`. Only `reveal()` returns the text, and the providers call it in
  one place each: building the auth header.
- Providers are given the key in a **header**, never a URL query parameter, so
  it cannot land in request logs, proxy logs, or an error that quotes the URL.
  `providers/google.ts` documents this explicitly — Google's API accepts both,
  and the wrong choice would put a live key in every access log hop.
- `ProviderError` carries a generic message; provider-side detail lives in a
  separate field that is never serialized into an HTTP response. That detail
  has the exact key text cut out (`redactKey`) and is scrubbed again on
  construction, so a provider that echoes the key back can't put it in a log.
- Every log line on the AI paths goes through `logError`, which scrubs.
- Sentry is scrubbed (`scrub.ts`, wired into events, transactions,
  breadcrumbs and spans) with its privacy options pinned in code
  (`sentry-options.ts`): no default PII, no local variables. An event that
  cannot be scrubbed is dropped rather than sent.
- **Correction (2026-09-30):** this section used to say the scrubber matched
  "every supported provider's key format". It didn't: Mistral, SambaNova and
  GitHub keys have no fixed prefix and slipped through. It now also catches
  GitHub token formats, long mixed-case random strings, and any value after
  a word like key/token/secret/password. Pattern matching is still the
  backstop, not the defence; the defence is the two layers above it.
- `/api/*` responses are `Cache-Control: private, no-store` (set in
  `src/proxy.ts`), so no shared cache keeps an AI answer or key list.
- **The build cache.** Next 16.3's Turbopack build cache stored a snapshot
  of the whole build environment, `AI_KEY_ENCRYPTION_SECRET` included, and
  Netlify kept it between builds. It is switched off (`next.config.ts`), and
  `npm run check:cache-secrets` proves a build leaves no secret in `.next`.
  The secret did sit in Netlify's saved cache before that, so rotating it is
  recommended (SECURITY-RUNBOOK.md §6).

### Abuse limits

Checking a key against its provider is capped per user per day and fails
**closed**: if the limiter itself is down, checks are refused rather than
unlimited, so the app can't be used to test stolen keys in bulk. The chat's
model re-check counts against the same cap. Key routes refuse bodies over 4 KB.
Each key shows when it was last used, so use the owner didn't make stands out.

### The limit, stated plainly

**An attacker with code execution on the server can read the environment and
decrypt at will.** No amount of at-rest encryption changes this, because the
server has to hold a usable key at the moment it calls the provider on the
user's behalf. Anyone claiming otherwise about this architecture is wrong.

Closing that would mean the server never holding a usable key: encrypt
client-side under a passphrase only the user knows, and have the browser supply
the decrypted key per request. The costs are real and worth stating before
anyone chooses it:

- The user re-enters a passphrase every session; the key cannot be recovered if
  they forget it.
- Scheduled or background AI work becomes impossible — there is no user present
  to unlock anything.
- The key is exposed in the browser's memory instead, which is a different
  attack surface, not obviously a smaller one for a user with a compromised
  machine or a malicious extension.

That trade has not been made. The current posture — safe against database
breach, database tampering, and a rotatable secret leak — is the appropriate
one for a server that calls providers on the user's behalf.

## 7. The AI chat: an offensive review (2026-09-21)

The chat (`/ask`) gives a model tools over the user's journal, on the user's
own provider key. It was reviewed the way an attacker would approach it --
OWASP's LLM Top 10 plus classic web -- with one framing that matters for
every Supabase app: **every signed-in user holds the anon key and their own
JWT, so they can call PostgREST directly and skip every Next route.** RLS and
grants are the boundary; the routes are convenience.

What held: no service-role client anywhere on the path; the model's
transcript is built server-side from rows this server wrote and the request
body is `{mode, message}` only; every tool is read-only, RLS-scoped and
allowlisted; the answer is rendered without links or images, so the
markdown-image exfiltration channel (how Copilot, Gemini and others were
made to leak) does not exist here; the key never enters the model's context.

What was found and fixed:

- **`ai_messages` could be written into another user's conversation.**
  0047's policy checked only the row's own `user_id`; a foreign-key check
  bypasses RLS, so anyone who knew a conversation UUID (it is in the URL)
  could insert rows that the owner's next turn fed to the model. 0048
  requires the conversation to be the caller's, and `listMessages` filters by
  the owner as well.
- **Two model calls could run at once on one conversation**, and `continue`
  worked on a finished answer. 0048 adds a per-conversation turn claim;
  `continue` with nothing pending is refused.
- **No Origin check on cookie-authenticated API writes.** `src/proxy.ts`
  now refuses cross-site non-GET `/api/*` requests (Sec-Fetch-Site, else
  Origin vs Host) and pins `SameSite=Lax` explicitly.
- **Key checks as an oracle.** Saving and testing a key both call the
  provider; they now share a 50/day budget on top of 5/min each.
- **Redirects.** Provider fetches use `redirect: "error"`: fetch strips
  `Authorization` on a cross-origin redirect but not `x-api-key`.
- Smaller: non-UUID ids 404 instead of 500; NUL refused in messages;
  model-chosen tool names are never rendered raw; strategy names and field
  labels are bounded before entering the system prompt; the create route no
  longer decrypts a key just to read its provider; the Sentry scrubber
  covers unprefixed (Mistral, SambaNova) tokens by position.

Known and accepted: a user can forge rows in their **own** conversation via
PostgREST. That harms only themselves today; the planned Apply feature must
therefore never treat `ai_messages` content as authoritative -- proposals
live in their own table and are re-validated against live rows on Apply.

## 8. Things deliberately not done in this pass

- **Auth not proxied through our own routes.** It would allow app-level auth
  rate limiting, but it is a significant architecture change and the Supabase
  dashboard controls in §1 address the same risk.

_(Previously listed here and now done: CSP flipped to enforcing — §3; rate
limiter moved to a global Postgres counter — §2. The operator steps that pair
with these code changes are in `SECURITY-RUNBOOK.md`.)_
