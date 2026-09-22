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

- **Enable CAPTCHA** (hCaptcha or Cloudflare Turnstile). This is the single
  most effective control available for these endpoints, because it applies at
  Supabase's edge where the requests actually land.
  After enabling it, the four auth screens listed above must each pass the
  resulting token through as `options.captchaToken` — **they do not do this
  today**, so enabling CAPTCHA without that code change will break sign-in.
  Treat it as one task, not two.
- **Enable leaked-password protection** (checks new passwords against Have I
  Been Pwned). The app currently enforces only `minLength=6`.

**Consider also**

- Raising the minimum password length above 6 (Supabase enforces this
  server-side; the client `minLength` attributes in the auth pages should be
  updated to match, or users get a server error where a form hint belongs).
- Whether to keep email confirmation on. `src/app/auth/confirm/route.ts` says
  sign-up no longer requires confirmation while `src/app/sign-up/page.tsx`
  still handles the awaiting-confirmation path; whichever is intended, the
  other should follow.

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
- Per-account analytics now also record which buttons a signed-in user
  presses (click autocapture, `src/lib/tracking/click-capture.ts`). This is
  still first-party, signed-in-only, and the label rule there keeps trade
  content out of the recorded label — so it does not change the banner
  assessment, but the privacy and cookies pages now state it plainly.
- A Data Processing Agreement with Sentry and Supabase has not been signed —
  that is required regardless of the banner question.

---

## 5. File upload posture

Already sound before this pass; recorded so it is not weakened by accident.

- MIME allowlist: JPEG, PNG, WebP, GIF. **SVG is excluded deliberately** — an
  SVG can carry `<script>`, and signed URLs are opened directly in the browser,
  which would make it stored XSS.
- 5 MB cap, plus a 50-megapixel ceiling so a decompression bomb cannot land
  during decode.
- Every upload is re-encoded through sharp. This both strips EXIF (phone photos
  of trading screens routinely carry GPS coordinates) and proves the bytes
  really are the image type the client claimed.
- **Storage keys never use the client filename.** The path is
  `{userId}/{tradeId}/{uuid}.{ext}` with the extension derived from the
  validated MIME type — so path traversal, collisions and executable
  extensions are all structurally impossible, not filtered against.
- Bucket `trade-images` is private, with owner-scoped RLS on all four verbs
  (`supabase/migrations/0012_trade_images_bucket.sql`). Files are served via
  short-lived signed URLs.
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

### If the encryption secret itself leaks

Recoverable, provided it is noticed. Rotation is supported:

1. Generate a new secret: `openssl rand -base64 32`
2. Set `AI_KEY_ENCRYPTION_SECRET` to the new value
3. Set `AI_KEY_ENCRYPTION_SECRET_PREVIOUS` to the old one (comma-separate to
   retire several generations at once)
4. Deploy, then run `npm run verify:ai-secret` to confirm both are readable

Stored keys keep working immediately and are re-encrypted under the new secret
the next time each one is used. Once every active key has been used at least
once, drop `AI_KEY_ENCRYPTION_SECRET_PREVIOUS`.

Before this, a leaked secret meant permanent compromise: there was no way to
change it that did not require every user to re-paste their key.

Rotating does **not** undo a leak that has already been exploited. If the
secret is known to have leaked, tell users to revoke and reissue their provider
keys — rotation protects the ciphertext going forward, not keys an attacker
already decrypted.

### Keys in logs and error reports

- Providers are given the key in a **header**, never a URL query parameter, so
  it cannot land in request logs, proxy logs, or an error that quotes the URL.
  `providers/google.ts` documents this explicitly — Google's API accepts both,
  and the wrong choice would put a live key in every access log hop.
- `ProviderError` carries a generic message; provider-side detail lives in a
  separate field that is never serialized into an HTTP response.
- Everything sent to Sentry is scrubbed first (`src/lib/observability/scrub.ts`,
  wired into `beforeSend` on server, edge and browser). It redacts values
  matching every supported provider's key format, our own ciphertext envelope,
  and JWT-shaped tokens, plus any field named like a credential. An event that
  cannot be scrubbed is dropped rather than sent.

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
