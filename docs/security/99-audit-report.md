# Security audit report (2026-10-10)

Covers the hardening brief (`SECURITY_HARDENING_1.md`), Phases 1–6 and Part B,
worked 2026-10-09 to 2026-10-10. The starting point and per-phase evidence are
in [00-inventory.md](00-inventory.md). Compliance detail is in
[compliance-notes.md](compliance-notes.md).

**This report does not say the app is secure.** It lists what was looked at,
what was found and fixed, what is still open, and what was never checked. Every
"fixed" item has a command or a test that proves it. Re-run those commands
after any change near that item.

## Where things stand

- **Not live yet.** Every fix below is committed **locally** (branches
  `security/p1-idor` … `improve/p2-screenshot-import`, plus this
  `security/p6-audit`). Nothing has been pushed. The live site,
  tradinglenz.netlify.app, only changes after a push to `main`.
- **Live database: done.** Migrations 0059–0062 were applied by hand
  (`npm run migrations:status`: 63 applied, 0 pending). The demo password
  was rotated on the live project. The Supabase sign-in limit is 5 per
  5 minutes per IP.
- **Most urgent open item: [F-20](#findings).** The live site runs Next.js
  16.3.3, which has seven critical advisories, among them remote code
  execution in `next/og`. This app uses `next/og` for its share images.
  This branch upgrades Next.js to 16.3.8. It only protects the live site
  once it is pushed.

## Findings

Severity is my judgement for this app: one public site, real user journals,
users' own AI keys held encrypted.
- **Critical:** code execution or another user's data.
- **High:** a secret exposed, or a direct path to one.
- **Medium:** a missing layer whose absence could be exploited.
- **Low:** wrong answers with no data leaked, or defence in depth.

| ID | Sev | Where | What was wrong | Status | How to verify |
|---|---|---|---|---|---|
| F-01 | High | DB: 8 foreign keys incl. `monthly_cost_postings`, `trade_images`, `ai_reviews`, `strategy_rules` (list in inventory) | A user could link their own row to another user's record. FK checks bypass RLS. | **Fixed:** 0059 `enforce_fk_owner` triggers, live | `npm run test:idor`: `postgrest.idor.test.ts` |
| F-02 | Low | `GET /api/trades/[id]/history` | Answered `200 []` for someone else's trade instead of 404. Nothing leaked. | **Fixed** | `routes.idor.test.ts` |
| F-03 | Low | `PATCH /api/strategies/[id]` | Every error, "not yours" included, came back as "name already exists". | **Fixed:** 404 / 400 / 500 | `routes.idor.test.ts`, unit tests |
| F-04 | Medium | OCR, AI review, Ask, import, export, excursions, market data | Only per-minute limits. A script pacing itself could run all day on our or the user's bill. | **Fixed:** daily per-user caps (`src/lib/rate-limits/daily.ts`) | unit tests; `ratelimit.idor.test.ts` |
| F-05 | Medium | Market-data routes | No app-wide limit in front of the unofficial Yahoo endpoint | **Fixed:** shared 600/min ceiling | unit tests |
| F-06 | Medium | Every non-GET `/api` route | No general body-size cap. A handler buffered whatever it was sent. | **Fixed:** proxy refuses over 1 MB (6 MB for uploads) with 413 | `validation.idor.test.ts` (413 cases) |
| F-07 | Low | `src/lib/rate-limit.ts` | A refusal could say `Retry-After: 0` | **Fixed** | unit test |
| F-08 | High | `scripts/seed-demo-account.mjs` | The demo account's password sat in the public repo as a default, since 2026-09-08 | **Fixed:** env/flag only, never printed. Rotated on live. | `gitleaks` (below); old password no longer signs in |
| F-09 | Medium | CI | No secret scan, no browser-bundle secret check | **Fixed:** gitleaks full-history job + `check:bundle` in `ci.yml` | CI run on next push |
| F-10 | Medium | 11 routes (field-definitions, settings, folders/strategies links, demo, …) | No schema validation. Three real bugs came out of adding it: editing a custom field was always refused; a malformed folders/strategies list **removed every link**; `"false"` read as true. | **Fixed:** zod on every input route | `validation.idor.test.ts` (126 cases) |
| F-11 | Medium | Screenshot upload, OCR | File type came from what the browser declared. The GIF branch stored raw bytes, so an SVG/HTML file labelled as GIF was stored. | **Fixed:** type from the first bytes (`src/lib/images/magic.ts`), GIF must decode as GIF | `validation.idor.test.ts`, unit tests |
| F-12 | Medium | Storage bucket `trade-images` | No size or type limit, so a direct Storage upload skipped the route's checks | **Fixed:** 0060, 10 MB, jpeg/png/webp/gif, live | `validation.idor.test.ts` |
| F-13 | Low | Plan/admin checks | Two loose flags read in several places | **Fixed:** `src/lib/auth/roles.ts`, fail closed | `roles.test.ts` |
| F-14 | Low | `/admin` | Per-page checks only, with no backstop | **Fixed:** `admin/layout.tsx` redirect, plus a test that every admin page and route calls `isAdmin()` | `admin-gates.test.ts` |
| F-15 | Medium | Session cookies | Not `Secure` (the library default) | **Fixed** in production builds | Inspect cookies on the live site after push |
| F-16 | Medium | `/api/analytics/track` | Accepted any event name and props, including names only the server should write. An admin could be shown forged activity. | **Fixed:** typed registry, unknown/server-only events refused | `events.test.ts`, track route tests |
| F-17 | Compliance | Sign-up | No age or Terms consent recorded | **Fixed:** checkbox + 0061 (live). Existing users confirm once after sign-in. | Sign up on dev; `consent` tests |
| F-18 | Compliance | `/privacy` | Didn't name Netlify, Cloudflare Turnstile or Yahoo. Contradicted itself on where OCR runs. | **Fixed** | Read `/privacy` |
| F-19 | Compliance | Account | "Download my data" covered trades only | **Fixed:** full JSON export of every user table; a test fails if a new table is left out | `data-export.test.ts`, `export.idor.test.ts` |
| F-20 | **Critical** | `next` 16.3.3 | 7 critical advisories: RCE in `next/og` ImageResponse (GHSA-vcvr-r3jv-pc5j), SSRF in image optimization (GHSA-cjq9-62q9-8jv4), cache poisoning (GHSA-4jqv-mc3x-m676, GHSA-mcj8-r9mp-w47p), info disclosure (GHSA-f87g-xv8r-7p7x, GHSA-3w37-wq28-93x7, GHSA-39w2-rjm5-chcv, dev server only). I did not work out which of these can actually be exploited on Netlify. Treat all as live. | **Fixed locally:** 16.3.8. **Open on live until pushed.** | `npm audit --omit=dev` → 0 |
| F-21 | High | `sharp` | librsvg advisory (GHSA-wq5f-xc86-pv6w). Exposure was low, because SVG is refused by its bytes before sharp sees it. | **Fixed locally:** 0.35.5 | `npm audit --omit=dev` |
| F-22 | High / Mod | `brace-expansion`, `source-map-js`, `fast-uri` (transitive) | DoS advisories | **Fixed locally:** `overrides` in `package.json` | `npm audit --omit=dev` |
| F-23 | Low | `src/app/api/ocr/ai/route.test.ts` | gitleaks flagged a uuid named `KEY`. It is a record id, not a secret. | **Fixed:** renamed `KEY_ID`, old commit fingerprint in `.gitleaksignore` | `gitleaks` clean |
| F-24 | Process | Seed scripts, e2e | Ran against the **production** project with no guard. This is where the throwaway accounts on live came from. | **Partly fixed:** the cross-user suite runs only on the dev project and refuses the prod URL (`src/lib/env/dev-guard.ts`). Seeds/e2e guard: **open**, next task (test-account cleanup). | `dev-guard.test.ts` |

## Open: decisions and actions for Alon

1. **Push, soon (F-20).** The live site has a critical Next.js advisory
   until `main` with this branch is pushed. Before pushing: run the app
   locally (`npm run dev`, check `/`, `/trades`, sign-in, a screenshot import,
   Admin → Activity). The production build here passed, and so did
   `check:bundle` and `check:cache-secrets`.
2. **Login limit is per IP, not per account.** The brief asked for "5 tries
   per 15 minutes per account". Sign-in goes from the browser straight to
   Supabase, so this app never sees the attempts. What exists:
   - Supabase's per-IP limit (now 5 per 5 min)
   - Turnstile
   - Supabase's own protections

   Per-account limiting would mean proxying auth through our server, which
   was decided against (`SECURITY.md` §1, §8).
3. **Screenshot links last 1 hour** (the brief: 10 minutes). The trade page
   loads screenshots lazily, so a shorter link breaks images for anyone who
   reads notes first. Shortening needs a "refresh the URL" step first.
   Kept at 1 hour; the links are per user and unguessable.
4. **Session cookies are readable by page script** (not `httpOnly`). The
   browser Supabase client needs to read them. The control is the enforcing
   CSP with nonces. Changing this means server-only auth, a large rewrite.
5. **Legal wording needs a lawyer.** The age minimum (18), Terms consent,
   the footer disclaimer and the privacy page were written carefully but not
   by a lawyer. Users are worldwide, so GDPR was assumed. Details:
   `compliance-notes.md`.
6. **Old demo sessions.** The leaked demo password no longer works, but a
   browser that signed in with it before the rotation could still hold a
   session. To end them, run this in the Supabase SQL editor:
   `delete from auth.sessions where user_id = '456454b2-53c2-4252-9ae5-e8f8fe7935c2';`
7. **Dev-tool advisories.** `npm audit` (all deps) still lists 7 (5 high, 2
   moderate), all in test/build tooling (vitest's mocker, `braces` via file
   watchers). None ships to users. `npm audit fix --force` would bump major
   versions of test tooling, so I left it for a separate change.
8. **"Read with AI" accuracy is unmeasured.** It needs recordings made with
   your own key: `AI_EVAL_PROVIDER=openai AI_EVAL_KEY=... npm run ocr:eval-ai -- --live`.
   Until then, the guarantee is structural: values are filled in only at
   ≥0.8 confidence with the source text quoted, code cross-checks the row,
   and an unreadable answer is a 502, never a guess.
9. **Broker coverage.** The offline reader's eval set is 17 images.
   `scripts/ocr-eval/fixtures/BROKERS.md` lists the 10 most-used brokers and
   which screenshots would close the gaps.

## How to re-test

Run from the repo root. The `test:idor` suite needs `.env.test.local` (dev
project keys), and it refuses to run against production.

| What | Command | Expect |
|---|---|---|
| Types, lint | `npx tsc --noEmit` · `npm run lint` | clean, 4 old warnings |
| Unit tests (incl. OCR regression replay, admin gates, export coverage, event registry) | `npm test` | 1,610 pass |
| Cross-user, validation, rate-limit, consent, export (dev project) | `npm run test:idor` | 303 pass |
| Screenshot reader | `npm run ocr:eval -- --min=0.95` | 97.3%, 0 wrong auto-fills |
| "Read with AI" replay | `npm run ocr:eval-ai` | "No recorded AI answers yet" until recorded |
| Secrets in the shipped bundle / build cache | `npm run build` then `npm run check:bundle` · `npm run check:cache-secrets` | clean (restart `next dev` after a build) |
| Secrets in git history / working tree | `gitleaks git --redact .` · `gitleaks dir --redact .` | no leaks found |
| Dependency advisories | `npm audit --omit=dev` | 0 |
| Live migrations | `npm run migrations:status` | 0 pending |
| Headers on a production build | `npx next start -p 3015`, then `curl -sI localhost:3015/` | HSTS, CSP (enforcing), nosniff, XFO DENY, Referrer-Policy, Permissions-Policy, COOP |

## What was not checked

- **The live site itself.** No test touched production apart from the
  read-only migration status and the demo password rotation. Everything ran
  locally or on the dev project. Nobody did a penetration test of
  tradinglenz.netlify.app.
- **Whether each Next.js advisory is exploitable on Netlify.** I upgraded
  instead of investigating.
- **Supabase dashboard settings** other than the sign-in limit:
  - password strength and leaked-password protection
  - MFA
  - email templates
  - SMTP
  - session lifetime
- **Netlify settings:**
  - which env vars reach deploy previews
  - team access
  - build hooks
- **GitHub settings:**
  - branch protection
  - Actions permissions
  - who has write access
  - the backup workflow's secret handling (reviewed in September, not again)
- **The platforms' own security** (Supabase, Netlify, Cloudflare, the AI
  providers), and DoS protection below the app's own rate limits.
- **Dependency source.** Only the advisory database was consulted. No
  package's code was reviewed.
- **Sentry event contents** were not re-reviewed in this pass. The scrubber
  has its own tests.
- **Restoring from a backup** was not re-tested.
- **Prompt injection** was assessed in the code, not attacked. All 13 Ask
  tools are read-only and answers render as plain text. Injected text in a
  note or screenshot can still mislead an answer or a screenshot reading:
  - an answer is only ever text, so it can mislead but cannot act;
  - a screenshot reading is checked by code, and a doubtful value is only
    suggested, never filled in.
