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
| `POST /api/ask-ai` | see route | Paid third-party API call |
| `POST /api/ai-reviews/*` | see route | Same |
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

### Known limitation: per-instance, not global

`src/lib/rate-limit.ts` keeps its counters in module memory. Serverless
instances do not share memory, so a client whose requests land on several warm
instances gets a proportionally higher effective limit. This bounds runaway
clients and cost; it is **not** a defence against a distributed attacker.

Upgrading to a real global limit means Redis (Upstash) or a Postgres counter,
and a round-trip per request. Worth doing if abuse is ever observed; not worth
the latency and the dependency before then.

---

## 3. Content Security Policy — still Report-Only

`src/proxy.ts` builds a full CSP with a per-request nonce and `strict-dynamic`,
and sends it as `Content-Security-Policy-Report-Only`. Every directive is the
one intended for enforcement; violations are reported, not blocked.

**To enforce:** rename that single response header to
`Content-Security-Policy`. Do it as its own deploy, after watching real browser
consoles for a few days, so a missed origin shows up as a report rather than as
sign-in breaking in production.

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
- Analytics starts running for logged-out visitors on public pages.
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

## 7. Things deliberately not done in this pass

- **CSP not flipped to enforcing** — separate deploy, see §3.
- **Auth not proxied through our own routes.** It would allow app-level auth
  rate limiting, but it is a significant architecture change and the Supabase
  dashboard controls in §1 address the same risk.
- **Rate limiter not moved to Redis** — see §2.
- **`public/screenshots/*.png` not deleted.** Three files referenced nowhere in
  `src/`. They may be for a README or a store listing, so they await owner
  confirmation rather than being removed on a guess.
