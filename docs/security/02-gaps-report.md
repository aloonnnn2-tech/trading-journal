# Security gaps pass: audit report (Step 0, 2026-10-18)

**Progress:** Phase 1 committed (`dde23ca`). Phase 2: migration 0073 plus the upload route change. Migrations 0072 and 0073 were applied on dev and live (2026-10-18, verified: anon refused, the cross-user suite passes 313/313). Phases 3 and 4 committed. Phase 5 (limits and account lifecycle) committed; its migration 0074 waits to be pasted on dev and live. Phase 6 (email, backups, recovery) committed: no migration.

This is the audit for the brief `02-security-gaps.md`. That brief covers what
`SECURITY_HARDENING.md` (report: [99-audit-report.md](99-audit-report.md)) and
`01-production-readiness.md` (report: [../production-readiness.md](../production-readiness.md))
did not. **No code was changed for this report.** Every row cites real files
and lines, or says "not found".

**This report does not say the app is secure.** It records what was checked
and how. The "What this audit did not check" section lists what was not.

## How this audit was done

- **Code read:** the working tree of branch `sec2/phase-0-audit`, taken from
  the latest local work. The uncommitted 2026-10-17 round (stop-limit,
  candle picker, emotions, review discussion, migration 0071) is included.
- **Probes:** two read-only checks, both against the **dev** database, which
  has the same migrations as live:
  - an anon-key call to `rate_limit_hit`;
  - the public GitHub API, for CI results.
- **Live database:** never queried or written.
- **Secrets:** none appear in this file. Credential locations are given as
  file and line.

**The brief is out of date in places.** Where its defaults were wrong, I
overrode them:

| The brief says | Today |
|---|---|
| 920 tests, no component or e2e tests | about 1,850 unit tests plus about 20 Playwright e2e specs |
| migrations 0000–0039, nothing records which are live | 0000–0071, with a `schema_migrations` ledger (`npm run migrations:status`, 72/72 applied) |
| 49 API routes | 78 route files (inventory in §1.3 evidence) |
| export is XLSX only | full JSON account export (`src/lib/account/data-export.ts`), plus CSV/XLSX/JSON trade export |
| 6 AI providers | 9 selectable (`src/lib/ai-keys/types.ts`), all fixed hosts |

## Findings (most severe first)

| ID | Severity | Where | What | Status | How to verify |
|---|---|---|---|---|---|
| G-1 | **High** | `supabase/migrations/0042_rate_limit_counters.sql:44,87`; `0043_*.sql:293,310` | `rate_limit_hit` is SECURITY DEFINER and anyone with the public anon key can call it. **Confirmed on dev** (the call returned `allowed:true`). The app-wide market-data ceiling uses one fixed bucket, `upstream:yahoo` (`src/lib/rate-limits/daily.ts:79`), so anyone could use it up and stop charts, fills and excursions for every user. `prune_click_events` has the same grant pattern (it deletes click analytics) and was not executed. Cause: `revoke … from public` does not remove Supabase's direct grants to `anon`/`authenticated`. | **fixed in migration 0073 (Phase 2); applies once pasted** | `select has_function_privilege('anon','rate_limit_hit(text,int,int)','execute');` on live; after the fix, an anon RPC call returns permission denied |
| G-2 | **High** | 0012 storage policies; `src/app/api/trades/[id]/images/route.ts`; `src/app/api/account/delete/route.ts:33-39` | Signed-in users can upload straight to their own `trade-images` folder through the Storage API. That skips the 4 MB limit, the magic-byte check, the re-encode and EXIF strip, the rate limit and the row cap. Only the bucket's 10 MB and MIME checks apply, and there is no per-user byte quota. Account deletion removes only files listed in `trade_images`, so directly uploaded files outlive the account. | **fixed: 0073 drops the direct insert/update policies; the route uploads with the service role (Phase 2). Deletion by folder done in Phase 5 (`src/lib/account/delete-account.ts`).** | an e2e test: direct upload refused, or counted and removed on delete |
| G-3 | **High** | `.github/workflows/ci.yml:47`; `scripts/check-bundle-secrets.ts:65,81-84` | **CI has failed on every run** (latest on main: 2026-10-13, run 38379096549). The bundle-secrets step reads only `.env.local`, which CI never has, and exits 1. A red CI hides real failures. | **fixed (Phase 3): the check reads the declared names from the environment when there is no .env.local; verified locally and CI-like** | CI green on the branch |
| G-4 | Medium | `src/lib/supabase/cookie-options.ts:18-21`; `@supabase/ssr` default maxAge 400 days | The session cookie is readable by scripts, by design: about 10 browser-side auth calls need it. Any XSS becomes account takeover. Mitigated by the nonce CSP with `strict-dynamic` and no unsafe HTML on AI paths. | needs Alon (Q1) | — |
| G-5 | Low | `src/lib/auth/error-messages.ts:46-52`; `src/app/sign-up/page.tsx:84-92` | **Alon (2026-10-18): email confirmation is ON in production.** `docs/dev-accounts.md:34-36` says it's off ("matches production"), which is wrong. With confirmation on, Supabase answers a sign-up for an already-confirmed email with an obfuscated user and no error, so the page shows "check your inbox" either way: not enumerable. The "An account already exists" mapping only fires on projects with confirmation off (the dev project). | mostly closed; doc fix → Phase 1 | e2e on a confirmation-on project, or Alon signs up twice with one address on live and sees the same screen |
| G-6 | Medium | `src/app/api/commission-rules/recalculate/route.ts:118,140`; `src/app/api/ocr/parse/route.ts:93-96`; `src/lib/ocr/pipeline.ts:180,196` | Raw Supabase or internal error text is returned to the browser. There is no shared "log the detail, return a generic error" helper. | **fixed (Phase 3): `src/lib/api/server-error.ts`; the three leaks replaced; a forced DB error is tested not to leak** | test: a forced DB error does not reach the response |
| G-7 | Medium | `scripts/db-tables.ts` | The nightly backup leaves out `ai_proposals` (0070), `ai_review_versions` and `ai_review_messages` (0071), and nothing tests the list against the migrations (the data export has such a drift test). | **fixed (Phase 6): the four tables added (`admin_audit_log` too); `BACKUP_EXCLUDED` names every table left out and why; `src/lib/backup/db-tables.drift.test.ts` fails on a table in neither list and on a child listed before its parent (which found G-21)** | the drift test |
| G-8 | Medium | no audit table in any migration; `src/app/api/admin/*` | No admin audit trail for plan changes, exclusions, featured reviews, waitlist export or delete. | **fixed: 0072 + `src/lib/admin/audit.ts` (Phase 1); applies once pasted** | migration + helper tests |
| G-9 | Medium | demo account `demo@tradinglens.app` (`scripts/seed-demo-account.mjs:51,509`) | The shared demo account is a paid account with no server-side write restrictions. The only check, `excluded_from_analytics`, blocks just `PUT /api/reviews/mine`. Whoever holds its password can change its data, add AI keys and spend its quotas. **Alon (2026-10-18): it should not be read-only**, so this is accepted. The password stays private (env only). | accepted | — |
| G-10 | Medium | `netlify.toml` (no `[context.*]`) | Nothing in the repo stops deploy previews or branch deploys from running with the live service-role key, `CRON_SECRET` and the encryption secret (also listed as unchecked in 99-audit-report.md:146). The repo is public. | **needs Alon: [netlify-checklist.md](netlify-checklist.md) (Phase 4)** | Netlify checklist |
| G-11 | Low | `docs/cleanup/test-accounts-report.md:47` | A literal old default password (from `seed-fake-data.mjs`) is in a tracked doc and in history (commits `950d199`, `c691b5a`). The account it belonged to was deleted on 2026-10-10. | **fixed (Phase 6): redacted; no tracked file holds it now (checked with `git grep`). History left as is (Q12)** | `git grep` |
| G-12 | Low | repo root `TRADING-LENS-EVERYTHING.txt` | An untracked file that is **not** gitignored, so one `git add -A` publishes it. No passwords, but it names the admin and demo emails (l.516-517). | **fixed (Phase 6): gitignored** | `git check-ignore -v TRADING-LENS-EVERYTHING.txt` |
| G-13 | Low | `src/proxy.ts:386-402` matcher | Non-API paths ending in an image extension skip the proxy, so a forged `x-user-id` header reaches page code (`requireUserId`, root layout). Reads still go through RLS with no session, so no data is exposed. | **fixed (Phase 1): matcher limited to public/'s files; tested** | proxy test |
| G-14 | Low | `src/lib/market-data/yahoo.ts:89,241`; SYMBOL regexes | A ticker made only of dots (`..`) passes every check and moves the request path up within Yahoo's host. Stored tickers reach Yahoo with no character check (`guessYahooSymbol`). Fetches follow redirects. | **fixed (Phase 3): `isSafeYahooSymbol` inside every `fetchYahoo*` (no request for an unsafe symbol), ticker character rule in `coreFieldsSchema`; tested. Redirects within Yahoo accepted: the host is fixed and no credentials are sent.** | tests with `..`, `%2e`, `@` |
| G-15 | Low | `src/app/api/account/delete/route.ts` | Deletion ignores storage errors, leaves no audit record, leaves the waitlist row, and does not remove files outside `trade_images` (see G-2). The privacy page says nothing about backups keeping data for up to 90 days (`src/app/privacy/page.tsx:198-199`, backup retention 30/90 days). | **fixed (Phase 5): the whole `{userId}/` folder is removed (paged, only inside that folder), any storage error stops the deletion before the account goes, the waitlist row goes (exact address only), an `account_delete` audit entry (id only), and the privacy page now covers deletion, the record kept and backup retention** | `src/app/api/account/delete/route.test.ts`, `src/lib/account/delete-account.test.ts` |
| G-16 | Low | `package.json` `allowScripts`; no `.npmrc` | Install-script allowlist exists but is not enforced (`strict-allow-scripts` unset); stale sharp entries. `tesseract.js` and `src/lib/ocr/engines/tesseract.ts` are dead code that would download a model with no integrity check. | **reported with recommendations in [dependencies.md](dependencies.md); changes to install behaviour and removals wait for Alon** | — |
| G-17 | Low | `next.config.ts` (`withSentryConfig`) | Production source maps are deleted only because of a Sentry SDK default (0 `.map` files in a local build). Not stated explicitly, and not checked. | **fixed (Phase 3): explicit in next.config.ts; check:bundle fails on any .map or sourceMappingURL** | `.map` check in CI |
| G-18 | Low | `src/lib/auth/error-messages.ts:59-60`; `src/app/reset-password/page.tsx:134` | Stale "at least 6 characters" password copy and `minLength={6}`; the real minimum is 8. | **fixed (Phase 1)** | — |
| G-20 | Low | `src/lib/trades/export.ts` (`tradeToRow`) | Found in Phase 5. A custom-field value stored as a JSON object (`custom_fields` isn't shape-checked, and the JSON import and the API can write one) reached ExcelJS as an object, and ExcelJS writes `{ formula }` as a **live formula** and `{ hyperlink }` as a link (confirmed by a probe: cell types 6 and 5). Plain text starting with `=` was already safe (a string cell). Mostly self-inflicted, but a crafted journal file someone is talked into importing would carry it. | **fixed (Phase 5): any non-plain value is written as its JSON text** | `src/lib/trades/export.xlsx.security.test.ts` reads the file back |
| G-21 | Medium | `scripts/db-tables.ts` | Found in Phase 6 by the new drift test. `field_definitions` was restored before `strategies`, but since 0017 a strategy-specific field references its strategy. A restore into a **fresh** project would have failed (foreign key) on the first such field, and stopped partway: `restore-db.ts` doesn't roll back. Restores into the same project were unaffected (the parent rows exist). | **fixed (Phase 6): reordered; the drift test now checks every foreign key's order** | drift test; fresh-account restore drill on dev |
| G-22 | Medium | `scripts/backup-db.ts`; `auth.users` | **The backups hold no sign-in accounts.** After losing the whole project, the data can be restored (accounts recreated by id with placeholder emails, proven on dev), but nobody could sign back into their account: their email addresses aren't anywhere. A real recovery would have to match people to accounts by hand. Backing up the account list (ids, emails, sign-up dates through `listUsers`; no passwords) would close it, but it puts email addresses into the backups. | **needs Alon (Q13)** | — |
| G-23 | Low | `backups/` on Alon's PC | `npm run backup:db` writes **unencrypted** dumps to `backups/<stamp>/`, and nothing ever deletes them. One from 2026-08-13 is there now (live data). The privacy page's "backups leave after 90 days" covers the encrypted GitHub copies, not these. | **needs Alon: delete the old folder, and remove each hand-made dump once its job is done** | `ls backups/` |
| G-19 | Info | `src/lib/accounts/classify.ts:19-20` | The owner's personal email addresses are hard-coded in a public repo. | needs Alon | — |

## Per-item audit

Dispositions: IMPLEMENT, VERIFY (ok or gap), N/A. "(default overridden)" marks
a disposition that differs from the brief's default, with the reason.

### Phase 1: account and access hardening

| # | Item | Disposition | Evidence | Planned fix or reason N/A |
|---|---|---|---|---|
| 1.1 | 2FA on admin-power accounts | IMPLEMENT (checklist) | Accounts that reach production, from env names and docs: Supabase prod and dev (`.env.local`, `.env.test.local` names); Netlify (`netlify.toml`, cron function); GitHub (Actions secrets in `backup.yml`); Sentry (`SENTRY_*`); Cloudflare Turnstile (`turnstile.tsx:41`); Google Cloud OAuth (`docs/google-sign-in-setup.md`); password manager (`docs/runbook.md:75`). Email/SMTP provider: not found. No app-wide AI/OCR provider account (keys are BYOK). 2FA status can't be seen from the repo. | `docs/security/account-checklist.md`, one checkbox list per account |
| 1.2 | Login cookie not HttpOnly | VERIFY: gap by design | `src/lib/supabase/cookie-options.ts:12-21` (no httpOnly, deliberate); library default maxAge 400 days. Browser client used by sign-in, sign-up, forgot and reset password, OAuth (PKCE verifier written from JS), resend, sign-out (3 places), `PlansPanel.tsx:72` getSession. No browser `.from()`, `.rpc()` or `.storage`. | Making it HttpOnly means moving about 10 auth calls server-side (route handlers). Propose only if Alon says yes (Q1). Meanwhile: consider a shorter cookie maxAge. |
| 1.3 | Auth inside every handler | VERIFY: ok, one low gap (G-13) | 78 route files, every one checks inside the handler: `getUserIdFromHeader` (`src/lib/supabase/auth.ts:19`), `requirePaidUser` (`src/lib/ai-keys/guard.ts:31`), `isAdmin` (`src/lib/auth/roles.ts:64`), or the cron bearer secret. Public by design: health, health/ready, waitlist, csp-report, analytics/public-view, auth/callback, auth/confirm/verify. The proxy strips any client `x-user-id` (`proxy.ts:270-271`). **Server actions: none** (`"use server"` not found). | Full route table goes in the Phase 1 report. Fix G-13 (image-extension matcher) and add a proxy test. |
| 1.4 | Supabase Auth settings | IMPLEMENT (checklist) | Not visible: no `supabase/config.toml`. In the repo: Turnstile on four auth forms; client password minimum 8 (G-18 mismatch); confirmation off (`docs/dev-accounts.md:34`); redirect URLs built from `window.location.origin` (sign-up:64, forgot-password:42, oauth-buttons:72), so the dashboard allowlist is the only control. Recommended values already in `SECURITY-RUNBOOK.md:13-86`. | `docs/security/supabase-auth-checklist.md`, with no guessed current values |
| 1.5 | Account enumeration | VERIFY: mostly ok (G-5) | Sign-in: `invalid_credentials` and `user_not_found` share one message (`error-messages.ts:38-42`). Reset: always "If an account exists…" (`forgot-password/page.tsx:67-69`). Sign-up: not enumerable on live because confirmation is on (Alon, 2026-10-18); see G-5. Waitlist: a duplicate returns ok. | Tests that pin the identical sign-in and reset messages; correct `docs/dev-accounts.md` (production has confirmation ON). |
| 1.6 | Admin audit trail | IMPLEMENT | Not found. Admin actions: `/api/admin/plan`, `/api/admin/analytics-exclusion`, `/api/admin/reviews/[id]`, `/api/admin/waitlist` (GET CSV, DELETE), admin page views (`src/app/admin/*`). Out-of-band: `supabase/cleanup/*.sql` and operator scripts. | Migration 0072 `admin_audit_log` (RLS on, no user policies, service-role writes); `src/lib/admin/audit.ts` helper; called from the admin routes and the admin layout; tests. Logs only user id, action, target and time. |
| 1.7 | Demo account restrictions | VERIFY: gap (G-9); **Alon (2026-10-18): the demo account should NOT be read-only**, so no write block. What stays worth doing: make sure its password is strong and private (it is: env only), and decide whether it should keep a paid plan (paid AI calls run on whatever key is added to it). | No demo identity check exists (`DEMO_ACCOUNT_EMAIL`/`isDemo`: not found). The only block is `excluded_from_analytics` on `PUT /api/reviews/mine` (`reviews/mine/route.ts:51-53`). The demo account is seeded with `plan:"paid"` (`seed-demo-account.mjs:509`). | Depends on Q5. If read-only: a server-side `isDemoAccount()` check (a flag on `user_settings`, set by migration, not an email match), applied to every write and AI route, with tests. |

### Phase 2: Supabase exposure

| # | Item | Disposition | Evidence | Planned fix or reason N/A |
|---|---|---|---|---|
| 2.1 | SECURITY DEFINER functions | VERIFY: gap (G-1) | 22 definer functions. All admin ones re-check `is_admin` against `auth.uid()` and set `search_path`. Demo-journal and heartbeat functions use `auth.uid()`. `record_public_view` was tightened in 0068. **Gaps:** `rate_limit_hit` and `prune_click_events` (no auth check, callable by anon: confirmed for the first). `admin_usage_series`, `admin_feature_usage`, `admin_retention_cohorts` were never revoked from public (harmless: they raise "not authorized"). `dashboard_stats` and `set_updated_at` set no search_path (invoker, low). Full table in the Phase 2 report. | Migration 0072/0073: `revoke execute … from anon, authenticated` on the two service-role functions; tidy the three admin grants; set search_path on the two invoker functions; IDOR test that anon/authenticated can't call them |
| 2.2 | Views | N/A | No `create view` or materialized view in any migration. | No views exist. |
| 2.3 | Grants to anon/authenticated | VERIFY: ok (plus G-1) | RLS enabled on all 32 tables, including 0070/0071. No `using (true)`. Five tables with RLS and no policies (service-role only). Column-level write lockdown on `user_settings` (`plan`, `is_admin` never granted), `user_api_keys`, `app_reviews`. | Covered by G-1's migration. Optionally an IDOR test asserting anon reads zero rows from every user table. |
| 2.4 | Realtime | N/A | No `supabase.channel`, realtime or publication anywhere in `src` or the migrations. | The app does not use Realtime. Alon can confirm the `supabase_realtime` publication is empty in the dashboard. |
| 2.5 | Storage buckets | VERIFY: gap (G-2) | One bucket, `trade-images`: private (0012:11), 10 MB per file and image MIME types only (0060), path `{userId}/{tradeId}/{uuid}.{ext}`, owner-folder policies for select, insert, update and delete (0012:15-29), signed URLs for 1 hour. No byte quota. | Decide (Q4/Phase 5): close direct uploads (drop the insert/update policies so uploads go through the server route with the service role), or count bytes per user. Account deletion removes by folder prefix. |
| 2.6 | Dev vs live separation | VERIFY: mostly ok, one gap (G-10) | `src/lib/env/dev-guard.ts` (fails closed), `dev-project.ts`, `playwright.config.ts:18-24,72`, seed, idor and bench scripts are all guarded. `npm run dev` deliberately uses live (`.env.local`). Deploy-preview env scoping can't be seen. | Netlify checklist (Phase 4). Document that `npm run dev` is live and `npm run dev:devdb` is dev. |

### Phase 3: server-side request abuse and output safety

| # | Item | Disposition | Evidence | Planned fix or reason N/A |
|---|---|---|---|---|
| 3.1 | SSRF / URL injection | VERIFY: low gap (G-14) | Fixed hosts everywhere. Yahoo: `yahoo.ts:89,168,241` (symbol URL-encoded; checks at `market-data/candles:30`, `bars:25`, `ai-keys/tools/general.ts:131`). AI providers: fixed hosts, `redirect:"error"` (`providers/types.ts:340`). No user-supplied URL anywhere. OCR is offline (Paddle). | Stricter symbol rule (at least one letter or digit, no dot-only segments) inside the `fetchYahoo*` functions so every caller is covered; `redirect:"error"` on Yahoo; tests with `..`, `%2e%2e`, `@evil.com`, `%00`, `127.0.0.1`. Custom provider endpoints: N/A (none exist). |
| 3.2 | AI output rendering | VERIFY: ok | Every model output goes through `src/app/ask/answer-text.tsx` (builds React elements, no links) or plain text (`review-thread.tsx`, proposal card, OCR panels). `dangerouslySetInnerHTML` only on static, nonced scripts (`design-flag.tsx:53`, `host-comment-cleanup.tsx:29`, `HomeV2.tsx:107`, `Faq.tsx:39`). No markdown library. Existing payload tests in `answer-text.test.ts:88-140`. | Add an `onerror` image payload test (the brief asks for one). No code change. |
| 3.3 | OCR output as untrusted | VERIFY: ok, small gap | OCR text never goes to a model (`/api/ocr/ai` sends the image; replies checked with zod). Saves go through `coreFieldsSchema`. Queries are parameterised or use `quoteOrValue` (`trades/queries.ts:367,417`). Gap: the trade schema caps ticker length only (`schema.ts:42`), so any characters can be stored and reach Yahoo paths and AI prompts. | Ticker character-set rule in `coreFieldsSchema` (also fixes G-14's stored path), with tests. |
| 3.4 | Verbose errors | IMPLEMENT (G-6) | Leaks: `commission-rules/recalculate:118,140`, `ocr/parse:93-96`, `ocr/pipeline.ts:180,196`, the cron response body (secret-gated, logged by `auto-execute-cron.mts`). Already clean: ai-keys routes, `providerErrorResponse`, error pages. Helpers that exist: `logError` (`observability/scrub.ts:154`), `log` (`log.ts:91`). | A shared `serverError(err, context)` helper (generic message plus request id; detail to redacted logs); replace the direct returns; test that a forced DB error doesn't leak. Zod field messages stay (they name fields, not internals). |
| 3.5 | Source maps and bundle | VERIFY: ok but implicit (G-17); CI check broken (G-3) | 0 `.map` files in a local build; Sentry 10.70 deletes them by default. `scripts/check-bundle-secrets.ts` scans for secret values but reads `.env.local` only. | Make `deleteSourcemapsAfterUpload` explicit; add a no-`.map` check; make the bundle check work in CI (read `process.env`, or skip cleanly with placeholder values). |

### Phase 4: supply chain and Netlify

| # | Item | Disposition | Evidence | Planned fix or reason N/A |
|---|---|---|---|---|
| 4.1 | Dependency review | IMPLEMENT (report) | 17 dependencies and 15 devDependencies; none look like typosquats. All used except `tesseract.js` (dead fallback, `ocr/engines/index.ts:69-80`). `date-fns` is used in one file only. `@types/node ^20` versus Node 24. `@gutenye/ocr-node` has a single maintainer and native dependencies: worth a closer look. | `docs/security/dependencies.md` with purpose, use, age and download scale (checked with the npm registry). Removals proposed, not done. |
| 4.2 | Install scripts | VERIFY: gap (G-16) | Postinstall hooks: `@sentry/cli`, `esbuild`, `onnxruntime-node`, `tesseract.js`, `unrs-resolver`. `package.json` `allowScripts` lists them, but there's no `.npmrc` and `strict-allow-scripts` is unset. | Recommend `.npmrc` `strict-allow-scripts=true` after checking npm versions on CI and Netlify; drop the stale entries. Ask before changing. |
| 4.3 | Lockfile and audit | VERIFY: ok | `package-lock.json` tracked (lockfile v3, every package with an integrity hash); CI and backup use `npm ci`; Dependabot configured (`.github/dependabot.yml`). `npm audit` (2026-10-18): 7 findings, all **dev-only**: 5 high in the `eslint-config-next` chain (braces, micromatch, fast-glob; the offered fix is a semver-major *downgrade* to 14.x, so don't apply it), 2 moderate in vitest/@vitest/mocker (fix available). The Netlify install command isn't in the repo. Gitleaks is downloaded without a checksum. | Report each with a recommendation; no forced upgrades. Pin the gitleaks checksum. |
| 4.4 | Netlify previews | IMPLEMENT (checklist) (G-10) | `netlify.toml` has only `SECRETS_SCAN_OMIT_PATHS`; no context sections. The repo is public, so fork-PR previews matter. | `docs/security/netlify-checklist.md`: turn off branch deploys and previews or scope env per context; check the fork-PR policy; restrict who can build. |
| 4.5 | Build log and env exposure | VERIFY: ok, notes | `src/lib/env/required.ts:18-23` prints names only; Sentry `silent`; no `printenv`, `set -x` or env logging. Notes: `scripts/backup-db.ts:117,179` prints row counts in public Actions logs; the cron function logs the response body. | Trim both to counts or status only (low). |
| 4.6 | Third-party scripts | VERIFY: ok | Fonts self-hosted through `next/font`. Turnstile is loaded dynamically under the nonce CSP and `strict-dynamic`; Cloudflare doesn't support SRI for it. Sentry is bundled. No other external script, stylesheet or analytics. | None. Turnstile's lack of SRI is recorded as an accepted vendor limitation. |

### Phase 5: abuse limits and data lifecycle

| # | Item | Disposition | Evidence | Planned fix or reason N/A |
|---|---|---|---|---|
| 5.1 | Per-user quotas | VERIFY: gap (overridden from IMPLEMENT: most limits exist) | Rows per account: 0067 (trades 100k, field_definitions 2k, folders 1k, trade_images 20k, …). Per-minute route limits. Daily caps (`src/lib/rate-limits/daily.ts`). Upload size 4 MB. Proxy 300/min. **Missing:** a byte quota on storage (G-2), uploads per day, row caps for `ai_proposals`/`ai_review_*`, and a single config file. Real usage: largest account 334 trades; 472 trades across 11 accounts (`docs/production-readiness.md:41`). | Add only the missing ones (storage bytes and files per user, uploads per day, caps for the 0070/0071 tables), sized from real usage with headroom; collect limits in one `src/lib/limits.ts` (DB caps stay in migrations, referenced). Numbers proposed to Alon (Q4). **Done (Phase 5):** `src/lib/limits.ts` (2,000 screenshots and 200 MB per account, 100 uploads a day, 300 trades created an hour; measured live 2026-10-18: largest 10 screenshots / 0.4 MB in all, 5 trades a day, 4 an hour); `src/lib/images/quota.ts` in the upload route; migration **0074** (`trade_images.size_bytes`, backfilled from Storage; row caps for `ai_proposals` 20k, `ai_review_versions` 20k, `ai_review_messages` 50k, each skipped if its table is missing). Without 0074 the route checks the file count only. |
| 5.2 | Mass fake signups | VERIFY: gap | Turnstile on all auth forms; Supabase per-IP limits (dashboard; `SECURITY-RUNBOOK.md:19-27`); confirmation **on** in production (Alon, 2026-10-18), so an account isn't usable until the address is proven; no disposable-email list; no cleanup of accounts that never confirmed (`scripts/list-accounts.ts` is read-only). | Proposal only: a small disposable-domain blocklist (Q3); a cleanup plan for accounts never confirmed after N days (report and SQL for Alon). **Done (Phase 5):** [disposable-email-proposal.md](disposable-email-proposal.md) (recommends nothing now, a server-side list with Phase 1b); `supabase/cleanup/0002_delete_stale_unconfirmed_accounts.sql` (preview, then a delete that refuses unless the count matches; never run). A database row cap now answers with a clear 429 in every create route and stops an import with a message, instead of a 500. |
| 5.3 | Account deletion | VERIFY: exists, gaps (G-15) (overridden from IMPLEMENT-if-missing) | `src/app/api/account/delete/route.ts`: removes `trade_images` files, then `auth.admin.deleteUser`; every table cascades from `auth.users`. Gaps: G-2 files, ignored storage errors, no audit record, waitlist row, privacy page silent on backups. Backups keep data up to 30 days (daily) or 90 days (weekly) (`backup.yml`). | Delete by `{userId}/` prefix (paged); fail on storage errors; audit record without personal data (uses the 1.6 table); privacy line about backup retention; Q7 (self-serve is already built). **Done (Phase 5), see G-15.** Left: backups made by hand (`npm run backup:db`) sit in `backups/` on the machine that ran them and never expire; the privacy promise about restores is a procedure for Phase 6's restore doc. |
| 5.4 | Data export completeness | VERIFY: ok, small gaps | JSON export of 27 tables, with a drift test (`data-export.test.ts`). Missing: the `auth.users` profile (email, created, last sign-in, providers), and storage files outside `trade_images`. CSV formula injection handled (`src/lib/trades/export.ts:51-64`, tested); XLSX relies on typed cells. | Add a profile section; a test that an XLSX cell starting with `=` is stored as text. **Done (Phase 5):** an `account` section (email, confirmed, created, last sign-in, sign-in methods; no identity ids) via `src/lib/account/auth-profile.ts`; the XLSX test, which found G-20. |
| 5.5 | Test and demo accounts on live | VERIFY: ok | `docs/cleanup/test-accounts-report.md` (9 accounts left after the 2026-10-10 cleanup), `supabase/cleanup/0001_*.sql`, classifier `src/lib/accounts/classify.ts`, creation guards (`src/lib/env/account-creators.test.ts`). | A fresh read-only `npm run accounts:list` report for Alon; a new reviewable SQL only if new test accounts show up. **Done (Phase 5):** `npm run accounts:summary` (counts only, no emails or ids). Live, 2026-10-18: 11 accounts, 10 confirmed, 1 unconfirmed (under 7 days old), 2 never signed in, all by email. No new test accounts. |

### Phase 6: email, backups and recovery proof

| # | Item | Disposition | Evidence | Planned fix or reason N/A |
|---|---|---|---|---|
| 6.1 | Email authentication records | N/A for now, with a note | The app sends no email itself; only Supabase Auth emails, using the built-in mailer (no custom SMTP found; 99-audit-report.md:143). No custom domain (`tradinglenz.netlify.app`). Support address in the app: `TradingLenzSupport@proton.me` (`src/app/contact/page.tsx:23` and others), described as live; the dead one was the old `support@tradinglens.app`, which is gone from `src/`. | Record the trade-off: Supabase's built-in mailer is heavily limited, so password-reset delivery to real users is unverified. SPF/DKIM/DMARC checklist when a custom domain or SMTP arrives (Q6). **Done (Phase 6):** [email-records.md](email-records.md): no records needed today, the trade-offs (delivery, phishing), the checklist for a domain, and two checks for Alon: send the support mailbox a test email, and try a password reset to a real Gmail/Outlook inbox. |
| 6.2 | Backup restore test | IMPLEMENT (procedure) | Nightly and weekly encrypted backups (`backup.yml`; the last 3 runs succeeded, 2026-10-16 failed at npm ci). Restore scripts dry-run by default. **No applied restore round-trip is recorded** (99-audit-report.md:162). Free plan, so no point-in-time recovery (`docs/runbook.md:44`). Gap G-7. | `docs/security/restore-test.md` (throwaway project, row-count comparison, timings, result log); fix `db-tables.ts` and add its drift test; fix the stale header in `scripts/restore-db.ts`. **Done (Phase 6):** [restore-test.md](restore-test.md), checked against Supabase's docs (free plan: no backups, no PITR; Storage never in their backups); new `scripts/restore-auth-placeholders.ts` (accounts by id; clears the seeded default fields, which would otherwise clash; refuses a project that has accounts); `restore-db.ts` restores the audit log only into an empty table (its id is `generated always`). **Proven on dev:** a same-project round trip (1,515 rows, 28 tables, all counts equal) and a fresh-account restore (25 rows back, trade identical). The full live drill is Alon's. |
| 6.3 | Service-role key handling | VERIFY: ok | Only through `src/lib/supabase/admin.ts` (`server-only`) and `src/lib/rate-limit.ts` (`server-only`). 13 server users, each with a stated reason (account delete/export/consent, admin, cron, health/ready, public-view, reviews/prompt, waitlist, vault, idempotency, tracking). No `NEXT_PUBLIC_` exposure; bundle check (broken in CI: G-3). A stray gitignored `flip.tmp.mjs` at the repo root uses the key. Rotation steps: `docs/runbook.md:70`. | List in the Phase 6 report; full rotation order (what breaks, in what order) in `SECURITY-RUNBOOK.md`; recommend deleting `flip.tmp.mjs`. No rotation. **Done (Phase 6):** [service-role.md](service-role.md): where the key lives, the 19 server files and why each skips RLS, the scripts, rotation in order with what fails if a step is missed. The key is the legacy JWT form; the log scrubber now also catches the newer `sb_secret_` form. Recommend deleting `flip.tmp.mjs` and `seed39.tmp.mjs`. |
| 6.4 | Demo credentials in documents | VERIFY: gap (G-11, G-12) | The current demo password is in no tracked file, history or untracked text file (checked against `.env.local` without printing it). The old default fake-account password is in `docs/cleanup/test-accounts-report.md:47` (account deleted). The earlier demo password (F-08) is only in old script history (`b80ed7c`…`5cca96d`) and was rotated. | Redact line 47; gitignore `TRADING-LENS-EVERYTHING.txt`; history rewrite is Alon's call (low value: the account is gone). **Done (Phase 6), see G-11 and G-12. Recommendation unchanged: no history rewrite.** |

### Phase 7: regression protection and outside review

| # | Item | Disposition | Evidence | Planned fix or reason N/A |
|---|---|---|---|---|
| 7.1 | Security regression tests in one place | IMPLEMENT | They exist but are scattered: `src/proxy.test.ts`, `rate-limit*.test.ts`, `body-limits.test.ts`, `export.security.test.ts`, `preprocess.security.test.ts`, `ai-keys/{crypto,secret,vault}.test.ts`, `scrub.test.ts`, `env/*.test.ts`, `admin-gates.test.ts`, `answer-text.test.ts`; cross-user suite `tests/idor/*` (`npm run test:idor`, dev project). | A `security` tag or folder: `npm run test:security` runs the unit security tests, the new ones from these phases, and the IDOR suite. Moving files is proposed, not forced. |
| 7.2 | Run them in CI | IMPLEMENT (G-3 first) | CI runs vitest (unit security tests included), lint, tsc, build, bundle check (failing), and gitleaks. Not in CI: `test:idor` (needs dev-project secrets as GitHub secrets), e2e. | Fix G-3; add a `test:security` step; the IDOR step runs only when the dev secrets exist (Alon adds them). File change only. |
| 7.3 | Outside review brief | IMPLEMENT (document) | Not found. The closest is 99-audit-report.md:132-170 ("not checked"). | `docs/security/external-review-scope.md` |

## Open questions for Alon

From the brief:
1. ~~HttpOnly session cookie?~~ **Answered (2026-10-18): yes, move the auth
   flows to the server** so the cookie can be HttpOnly. It is its own carefully
   tested step, proposed in detail before any change, because a mistake locks
   people out.
2. Do BYOK providers allow a custom base URL? **The code answers this:** no.
   Fixed hosts only, so the custom-endpoint SSRF rules are N/A unless one is
   added later.
3. Should disposable-email domains be blocked at sign-up (some real users may
   be blocked)?
4. What per-user storage and rate quotas feel right? The real usage is in
   5.1; the numbers will be proposed with headroom.
5. ~~Is the demo account meant to be read-only?~~ **Answered (2026-10-18):
   no.** It stays a normal account. Its password is already private (env
   only, rotated after F-08).
6. Will the site move to a custom domain (affects email records and cookie
   scope)?
7. Should account deletion stay self-serve? It is already built and works;
   the gaps are in G-15.
8. Is a paid outside review acceptable before taking payments, and roughly
   when?

New, from this audit:
9. ~~Email confirmation on or off?~~ **Answered (2026-10-18): it is on in
   production.** Follow-up: confirmation emails go through Supabase's
   built-in mailer, which has a low hourly sending limit. A burst of real
   sign-ups could get no email. Custom SMTP (a free tier such as Resend or
   Brevo) would remove that limit. Not urgent at today's sign-up rate.
10. ~~Direct storage uploads (G-2)?~~ **Answered (2026-10-18): close them.**
    Every upload goes through the server route; the storage policies stop
    allowing direct writes.
11. Should your personal email addresses stay hard-coded in the public repo
    (`classify.ts`)? They could move to an env variable.
12. Rewrite git history for the old password (G-11)? Recommended: no. The
    account is deleted; redacting the doc is enough.
13. Should the backups hold email addresses? Today they hold none, which is
    why a total loss can't reconnect people to their accounts (G-22) and why
    the waitlist isn't backed up. Recommended: **yes, both**. The backups
    already hold every journal, which is more sensitive than an address,
    and they are encrypted. But it is a privacy choice, so it's yours.

## What this audit did not check

- Anything only visible in the dashboards: Supabase Auth settings, Netlify
  deploy contexts and env scoping, GitHub branch protection, 2FA on any
  account, Sentry data scrubbing. These go to checklists.
- `prune_click_events` was not executed (it deletes data). Its anon access is
  inferred from its grants, not proven.
- The live database was only read, for counts: usage sizes for 5.1 and the
  accounts summary for 5.5 (service role, no writes, no emails printed).
  Otherwise the dev project is assumed to match it, per the migrations ledger.
- Migration 0074 and the cleanup SQL were reviewed by reading, not run: there
  is no SQL access from here. 0074 gets checked on dev once it's pasted.
- No penetration test of the live site. No dynamic scan.
- Netlify's install command and npm version.
- Whether Supabase's built-in mailer actually delivers password-reset emails
  to real users.
