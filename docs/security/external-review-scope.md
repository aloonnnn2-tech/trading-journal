# Trading Lens: scope for an outside security review

A brief to hand to an independent reviewer. Written 2026-10-18, at the end of
the security gaps pass ([02-gaps-report.md](02-gaps-report.md)). It names no
credentials; access is arranged separately (see "Test accounts").

**Recommendation:** commission this **before Trading Lens takes payments**.
It's best done after the HttpOnly sign-in change (Phase 1b, planned) is
merged, so the review sees the session model that will ship. Alon decides
when, and the budget.

## What Trading Lens is

A trading journal web app. Signed-in users log trades, attach chart
screenshots, read analytics, and can connect their **own** AI provider key
("bring your own key") to chat with their journal and get trade reviews.
The app is free, with a paid plan prepared; no payment processing exists yet.
There are about a dozen accounts today.

**The repository is public** (GitHub). A reviewer can read all of the code,
history included, and so can an attacker.

## Architecture

| Part | What | Where to look |
|---|---|---|
| Web app | Next.js 16 (App Router, `src/proxy.ts` in place of middleware), React 19, TypeScript | `src/app`, `src/lib` |
| Hosting | Netlify. Server routes run as Netlify Functions (60 s limit), plus a scheduled function every 5 minutes | `netlify.toml`, `netlify/functions/` |
| Database and auth | Supabase (Postgres with row-level security, Supabase Auth with email and password, email confirmation on, Cloudflare Turnstile CAPTCHA; Google sign-in prepared). Free plan | `supabase/migrations/` (about 75 files, applied by hand, recorded in `schema_migrations`) |
| Files | Supabase Storage, private bucket `trade-images`, served by short-lived signed URLs | `src/app/api/trades/[id]/images/` |
| AI | 9 selectable providers on fixed hosts. Keys stored AES-GCM encrypted (`AI_KEY_ENCRYPTION_SECRET`), readable only through `src/lib/ai-keys/vault.ts` with the service role | `src/lib/ai-keys/`, `src/lib/chat/` |
| Market data | Yahoo Finance's unofficial endpoints, fetched server-side | `src/lib/market-data/yahoo.ts` |
| Screenshot reading | PaddleOCR in a child process (native ONNX runtime); optional AI reading on the user's key | `src/lib/ocr/`, `ocr-worker/` |
| Monitoring | Sentry, with a scrubber | `src/lib/observability/` |
| Backups | Nightly and weekly GitHub Actions job: encrypted row dump plus screenshots | `.github/workflows/backup.yml`, `scripts/backup-db.ts` |

**How a request is trusted:**

1. `src/proxy.ts` verifies the session with `supabase.auth.getUser()`.
2. It strips any client-sent `x-user-id` and sets the verified one.
3. It refuses cross-site writes (Sec-Fetch-Site, then Origin against Host).
4. It applies a blanket per-user and per-IP rate limit, and sets a nonce CSP
   with `strict-dynamic`.
5. Each route then checks the caller itself: signed in, paid, or admin.
6. Database reads go through the user's own client, so **RLS is the
   ownership check**. The service-role client is used by 19 server files,
   each listed with its reason in [service-role.md](service-role.md).

## Route inventory

About 77 route handlers under `src/app/api`, and no server actions. The full
table is [route-auth-table.md](route-auth-table.md), giving each route's
method, who may call it, its rate limits and its service-role use. Admin
pages live under `src/app/admin`.

## What has already been done (so the review can go deeper, not repeat it)

- Three internal passes: `SECURITY_HARDENING` ([99-audit-report.md](99-audit-report.md)),
  production readiness ([../production-readiness.md](../production-readiness.md)),
  and the gaps pass ([02-gaps-report.md](02-gaps-report.md)). They were done
  by the developer with an AI coding assistant, **not by an independent
  party**. That is the reason for this review.
- Tests:
  - about 1,900 unit tests;
  - a security regression suite (`npm run test:security`, indexed in
    `tests/security/suite.ts`);
  - a cross-user suite of over 300 checks, with two real accounts on a
    separate dev Supabase project (`npm run test:idor`);
  - about 20 Playwright end-to-end specs.
- CSP enforced; security headers in `next.config.ts`; a secret scan of the
  full history (gitleaks) in CI; a bundle check that no server secret
  reaches the browser.

## Known gaps and decisions (please don't report these as new; do challenge them)

| ID | What | State |
|---|---|---|
| G-4 | The session cookie is readable by page scripts (Supabase's browser client needs it), so any XSS is account takeover | Planned: move sign-in to the server for an HttpOnly cookie (Phase 1b) |
| G-9 | The shared demo account is a normal, writable paid account | Accepted by the owner |
| G-10 | Netlify deploy contexts and environment-variable scoping are unverified (dashboard only) | Checklist with the owner |
| G-16 | npm install-script allowlist isn't enforced (`strict-allow-scripts` off) | Proposed, waiting |
| G-19 | The owner's personal email addresses are hard-coded in the public repo | Waiting |
| G-22 | Backups hold no sign-in accounts, so a total loss can't reconnect users | Waiting (privacy decision) |
| — | Rate limiting fails **open** if its counter is unavailable | By design (availability over strictness) |
| — | `style-src 'unsafe-inline'` (React style props, Framer Motion) | By design; script-src is strict |
| — | Supabase's built-in mailer (low limits, no custom domain) | Accepted for now ([email-records.md](email-records.md)) |

## In scope

1. **Authentication and sessions:** sign-up, sign-in, reset, confirm and
   OAuth callback flows (`src/app/auth/*`, `src/lib/auth/*`); session
   handling in `src/proxy.ts`; account enumeration; the CAPTCHA's
   placement.
2. **Authorization:**
   - every route against its stated level;
   - RLS policies in the migrations, including SECURITY DEFINER functions
     and grants;
   - Storage policies;
   - the admin pages;
   - the cron endpoint (`CRON_SECRET`);
   - the one service-role route under a dynamic segment (`SECURITY.md` §5).
3. **The AI features:**
   - prompt injection through journal text, screenshots, news headlines
     and tool results;
   - the tool layer (`src/lib/ai-keys/tools/`);
   - Ask's suggested changes, which a user applies
     (`src/lib/chat/apply-proposal.ts`): can a model or a crafted journal
     get a change applied that the user didn't see?
   - key storage and encryption (`src/lib/ai-keys/crypto.ts`, `vault.ts`).
4. **Input handling:** zod schemas, CSV, XLSX and JSON import, OCR output,
   the screenshot upload (re-encode, magic bytes, size and pixel limits),
   export formula injection.
5. **Outbound requests and SSRF:** Yahoo symbol handling, AI provider
   calls, redirects.
6. **Browser-side:** XSS (AI answer rendering, stored journal text), the
   CSP, clickjacking, CSRF on state-changing routes.
7. **Abuse and cost:** rate limits, daily caps, per-account quotas
   (`src/lib/limits.ts`), anything that lets one account cost real money
   or fill shared storage.
8. **Data lifecycle:** account deletion, the data export, backup encryption
   and the restore scripts.
9. **The public repository:** secrets in the code or history, deployment
   config, CI workflows (including `pull_request` triggers), and
   dependencies (`docs/security/dependencies.md`).

## Out of scope

- Supabase, Netlify, GitHub, Sentry, Cloudflare and the AI providers
  themselves (report a misconfiguration *of* them, not a flaw *in* them).
- Load testing and denial of service against the live site; social
  engineering; physical access.
- The owner's other repositories and personal accounts.
- Payments (none exist yet).

## Test accounts and environment

- **Test against a staging copy, not live.** The developer will set up a
  separate Supabase project and deploy, seeded with fake data
  (`npm run seed:fake`). Access goes to the reviewer privately.
- Accounts provided there: two free accounts and two paid accounts, so
  cross-account tests have a pair at each level, plus one admin account.
  Each has an AI key slot; use your own provider key if you need live AI
  calls.
- **Live site** (`tradinglenz.netlify.app`): passive checks only (headers,
  TLS, what any visitor sees), unless agreed in writing. No automated
  scanning, and no accounts created there.
- Code: the public repository, at the commit named when the review starts.

## What we'd like back

- Findings with severity, affected file or route, steps to reproduce, and a
  suggested fix.
- A short note on what you checked and found sound, so the next pass knows
  where not to spend time.
- One retest of the fixes.
