# Security inventory

Snapshot of commit `3bd32f2` (2026-10-09). Every later phase of the hardening
brief (`SECURITY_HARDENING_1.md`) works from this file. When a route, table or
policy changes, update it here.

**How it was built:** a script read every `src/app/api/**/route.ts` and the
library files it imports, two levels deep. A second script replayed
`supabase/migrations/*.sql` in order to get the final tables, RLS flags and
policies. The service-role routes were then checked by hand.

Two limits on the method:

- **The migration files are not proof of the live database.** They are pasted
  in by hand. `npm run migrations:status` shows which ones are applied.
- **The "Tables / RPCs" column can overstate.** It lists every table that a
  route's library imports can reach, so it may name a table the route never
  touches.

## How a request is authenticated

1. `src/proxy.ts` runs on every `/api/*` path except `/api/cron/*`. It:
   - calls `getUser()`;
   - **deletes any client-supplied `x-user-id`**;
   - sets `x-user-id` itself;
   - refuses non-GET requests from other sites (`isCrossSite`, Sec-Fetch-Site then Origin vs Host);
   - applies a blanket limit of **300/min per user, 60/min per IP when signed out**.
2. Routes read the user id with `getUserIdFromHeader()`
   (`src/lib/supabase/auth.ts:19`) and answer 401 when it is null. All 61
   routes that need a user do this, checked by script.
3. Paid routes use `requirePaidUser()` (`src/lib/ai-keys/guard.ts`). Admin
   routes use `isAdmin()` (`src/lib/tracking/admin-queries.ts:242`), which
   fails closed.
4. The database client is `createClient()` (`src/lib/supabase/server.ts`),
   bound to the user's cookie. **RLS is the ownership check.** Another user's
   id simply matches no row, so the route returns 404.

**Invariant:** never add a matcher exclusion that can catch an `/api` path.
Never put a service-role route under a dynamic `[id]` segment. Both rules are
recorded in `SECURITY.md`.

## API routes (65 handlers)

"Per-route limit = proxy only" means only the blanket 300/min proxy limit
applies to that route.

| Route | Methods | Auth | Client | Per-route limit | Validation | Tables / RPCs |
|---|---|---|---|---|---|---|
| `/api/account/delete` | DELETE | user | user + **service-role** | yes | manual / none | trade_images |
| `/api/account/export` | GET | user | user (RLS) + **service-role** (analytics only, filtered by header id) | 5/hr + daily | none (no input) | every user table (Part B) |
| `/api/account/transactions/[id]` | DELETE | user | user (RLS) | proxy only | manual / none | account_transactions, analytics_events, trades |
| `/api/account/transactions` | GET POST | user | user (RLS) | proxy only | zod | account_transactions, analytics_events, trades |
| `/api/admin/analytics-exclusion` | POST | admin | user (RLS) | yes | zod | user_settings, admin_* RPCs |
| `/api/admin/plan` | POST | admin | user + **service-role** | yes | zod | user_settings, admin_* RPCs |
| `/api/admin/waitlist` | GET DELETE | admin | user + **service-role** | yes | zod | user_settings, waitlist, admin_* RPCs |
| `/api/ai-keys/[id]` | PATCH DELETE | paid | user (RLS) + vault | yes | zod | user_api_keys, user_settings |
| `/api/ai-keys/[id]/test` | POST | paid | user (RLS) + vault | yes | manual / none | user_api_keys, user_settings |
| `/api/ai-keys/consent` | POST | paid | user (RLS) | proxy only | zod | ai_provider_consents, user_settings |
| `/api/ai-keys` | GET POST | paid | user (RLS) + vault | yes | zod | analytics_events, user_api_keys, user_settings |
| `/api/ai-reviews/[id]` | DELETE | paid | user (RLS) | proxy only | manual / none | ai_reviews, trades, user_settings |
| `/api/ai-reviews/period` | GET POST | paid | user (RLS) | yes | zod | ai_reviews, analytics_events, field_definitions, strategies, trade_images, trades, user_api_keys, user_settings |
| `/api/ai-reviews/trade` | POST | paid | user (RLS) | yes | zod | ai_reviews, analytics_events, commission_rules, field_definitions, strategies, trade_history, trade_images, trade_strategies, trades, user_api_keys, user_settings |
| `/api/analytics/heartbeat` | POST | user | user (RLS) | yes | zod | analytics_events |
| `/api/analytics/public-view` | POST | **public** | anon / none | proxy only | zod | rpc:record_public_view |
| `/api/analytics/track` | POST | user | user (RLS) | yes | zod | analytics_events |
| `/api/chat/conversations/[id]` | GET PATCH DELETE | paid | user (RLS) | proxy only | zod | ai_conversations, ai_messages, user_api_keys, user_settings |
| `/api/chat/conversations/[id]/turn` | POST | paid | user (RLS) | yes | zod | ai_conversations, ai_messages, analytics_events, field_definitions, strategies, trade_images, trades, user_api_keys, user_settings |
| `/api/chat/conversations` | GET POST | paid | user (RLS) | yes | zod | ai_conversations, ai_messages, user_api_keys, user_settings |
| `/api/commission-rules/[id]` | PATCH DELETE | user | user (RLS) | proxy only | zod | commission_rules |
| `/api/commission-rules/recalculate` | POST | user | user (RLS) | proxy only | manual / none | analytics_events, commission_rules, trades |
| `/api/commission-rules` | GET POST | user | user (RLS) | proxy only | zod | commission_rules |
| `/api/cron/auto-execute` | POST | cron bearer | **service-role** | – | manual / none | commission_rules, trades, user_settings, rpc:prune_click_events |
| `/api/csp-report` | POST | **public** | anon / none | proxy (120/min/IP) | manual, size-capped | – |
| `/api/demo` | POST | user | user (RLS) | yes | manual / none | trade_images, storage:trade-images, rpc:seed/decline/finish_demo_journal |
| `/api/excursions` | POST | paid | user (RLS) | yes | manual / none | trade_excursions, trades, user_settings |
| `/api/field-definitions/[id]` | PATCH DELETE | user | user (RLS) | proxy only | manual / none | field_definitions |
| `/api/field-definitions` | GET POST | user | user (RLS) | proxy only | manual / none | field_definitions |
| `/api/folders/[id]` | DELETE | user | user (RLS) | proxy only | manual / none | folders, trade_folders, trades |
| `/api/folders` | GET POST | user | user (RLS) | proxy only | zod | folders, trade_folders, trades |
| `/api/goals/[id]` | PATCH DELETE | user | user (RLS) | proxy only | zod | goals, trade_history, trades |
| `/api/goals` | GET POST | user | user (RLS) | proxy only | zod | goals, trade_history, trades |
| `/api/market-data/bars` | GET | user | none (Yahoo) | yes | manual / none | – |
| `/api/market-data/candles` | GET | user | none (Yahoo) | yes | manual / none | – |
| `/api/market-data/fx` | GET | user | none (Yahoo) | yes | manual / none | – |
| `/api/monthly-costs/[id]` | PATCH DELETE | user | user (RLS) | yes | zod | account_transactions, monthly_cost_postings, monthly_costs |
| `/api/monthly-costs` | GET POST | user | user (RLS) | yes | zod | account_transactions, monthly_cost_postings, monthly_costs |
| `/api/ocr/parse` | POST | user | user (RLS) | yes | manual / none | analytics_events, trade_images |
| `/api/ocr/ai` | POST | paid + consent `screenshot_v1` | user (RLS) + vault | 10/min + daily | zod key id, image bytes, size | user_api_keys (vault), trades (duplicate check); sends the image to the user's own AI provider |
| `/api/settings/core-fields` | PATCH | user | user (RLS) | proxy only | manual / none | user_settings |
| `/api/settings/dashboard-layout` | PUT | user | user (RLS) | proxy only | manual / none | user_settings |
| `/api/settings/preferences` | PATCH | user | user (RLS) | yes | zod | user_settings |
| `/api/settings/timezone` | PATCH | user | user (RLS) | proxy only | manual / none | user_settings |
| `/api/settings/tour` | GET PATCH | user | user (RLS) | proxy only | manual / none | trades, user_settings |
| `/api/strategies/[id]` | PATCH DELETE | user | user (RLS) | proxy only | zod | strategies, trade_strategies, trades |
| `/api/strategies` | GET POST | user | user (RLS) | proxy only | zod | strategies, trade_strategies, trades |
| `/api/strategy-rules/[id]` | PATCH DELETE | user | user (RLS) | proxy only | zod | strategy_rules |
| `/api/strategy-rules` | GET POST | user (free by design) | user (RLS) | proxy only | zod | strategies, strategy_rules |
| `/api/trades/[id]/duplicate` | POST | user | user (RLS) | proxy only | id only | analytics_events, commission_rules, trades |
| `/api/trades/[id]/export` | GET | user | user (RLS) | proxy only | id only | commission_rules, field_definitions, trades |
| `/api/trades/[id]/fee` | PUT | user | user (RLS) | yes | zod | commission_rules, trades |
| `/api/trades/[id]/folders` | PUT | user | user (RLS) | proxy only | **`Array.isArray` only** | folders, trade_folders, trades |
| `/api/trades/[id]/history/[historyId]/restore` | POST | user | user (RLS) | proxy only | id only | commission_rules, trade_history, trades |
| `/api/trades/[id]/history` | GET | user | user (RLS) | proxy only | id only | commission_rules, trade_history, trades |
| `/api/trades/[id]/images/[imageId]` | DELETE | user | user (RLS) | proxy only | id only | trade_images |
| `/api/trades/[id]/images` | POST | user | user (RLS) | yes | manual (MIME, size, pixels) | commission_rules, trade_images, trades |
| `/api/trades/[id]/panel` | GET | user | user (RLS) | yes | id only | commission_rules, field_definitions, strategies, strategy_rules, trade_history, trade_images, trade_strategies, trades, storage:trade-images |
| `/api/trades/[id]` | PATCH DELETE | user | user (RLS) | yes | zod | analytics_events, commission_rules, field_definitions, trades |
| `/api/trades/[id]/strategies` | PUT | user | user (RLS) | proxy only | **`Array.isArray` only** | strategies, trade_strategies, trades |
| `/api/trades/[id]/suggestions` | POST | user | user (RLS) | proxy only | zod | analytics_events, commission_rules, trades |
| `/api/trades/export` | GET | user | user (RLS) | yes | format allowlist | analytics_events, commission_rules, field_definitions, folders, trade_folders, trades |
| `/api/trades/import-json` | POST | user | user (RLS) | yes | zod | analytics_events, commission_rules, trades |
| `/api/trades/import/parse-xlsx` | POST | user | none | yes | manual (5 MB, 200 cols) | – |
| `/api/trades/import` | POST | user | user (RLS) | yes | zod | analytics_events, commission_rules, field_definitions, trades |
| `/api/trades` | POST | user | user (RLS) | yes | no body | account_transactions, analytics_events, commission_rules, trades |
| `/api/waitlist` | POST | **public** | **service-role** insert | yes (5/hr/IP) | custom + honeypot | waitlist |

### Service-role use: every call site

The service-role client bypasses RLS, so each call site is listed here with
what keeps it safe.

| Where | What it does | Why it is safe |
|---|---|---|
| `api/account/delete/route.ts:42` | `auth.admin.deleteUser(userId)` | `userId` comes from the proxy header, never from the request body. Files are removed first through the RLS client. |
| `api/admin/plan/route.ts:61` | Sets `user_settings.plan` for a target user | `isAdmin()` gate first. The target id in the body is intended: only an admin can reach this code. |
| `api/admin/waitlist/route.ts:36` | Reads and deletes waitlist rows | `isAdmin()` gate first. |
| `api/waitlist/route.ts:60` | Inserts an email | The table is service-role only, so the public cannot read it back. Honeypot plus 5/hr/IP. |
| `api/cron/auto-execute/route.ts` | Nightly jobs across all users | `CRON_SECRET` bearer compared with `timingSafeEqual`. Not reachable from the proxy matcher. |
| `lib/ai-keys/vault.ts:92,109,119,145` | Reads and writes encrypted keys | Every query is `.eq("user_id", userId)` with the header-derived id. Migration 0058 revoked the `authenticated` grants on `user_api_keys`. |
| `lib/rate-limit.ts` | Calls the `rate_limit_hit` RPC | Service-role only grant (0042), so the anon key cannot drain another user's bucket. |

No service-role call ever takes a record id from the request without an admin gate.

## Tables, RLS and policies (27 tables)

RLS is **enabled on all 27**. No policy uses `USING (true)`. Every owner
policy is `FOR ALL` with both `USING` and `WITH CHECK`.

| Table | Policy | Notes |
|---|---|---|
| trades, field_definitions, user_settings, folders, trade_history, trade_images, account_transactions, strategies, commission_rules, user_api_keys, ai_provider_consents, ai_reviews, strategy_rules, trade_excursions, goals, ai_conversations, monthly_costs, monthly_cost_postings | `auth.uid() = user_id` (all, using + check) | `user_settings.plan` / `is_admin` have no column grant for `authenticated` (0024/0029/0052/0054), so a user cannot write them. `user_api_keys` grants were narrowed in 0058. |
| trade_folders, trade_strategies | Both sides must belong to `auth.uid()` (0028) | The junction tables check **both** foreign keys. |
| ai_messages | Own `user_id` **and** the conversation is own (0048) | Fixed the cross-user chat insert found on 2026-09-21. |
| analytics_events | Insert own, select admin only | Users cannot read events back. |
| analytics_sessions | Insert / update own, select admin only | |
| rate_limit_counters, schema_migrations, waitlist, public_page_views | RLS on, **no policies** | Service-role / RPC only. |

**Storage, bucket `trade-images`** (0012): private. Select, insert, update and
delete are allowed only when `foldername(name)[1] = auth.uid()`. Paths are
`{user_id}/{trade_id}/{uuid}.{ext}`, never the user's filename. Signed URLs
last **3600 s** (`images/route.ts:153`, `panel/route.ts:66`,
`trades/[id]/page.tsx:136`). There is **no bucket-level `file_size_limit` or
`allowed_mime_types`** (see Phase 4).

### Foreign keys that RLS does not check

A foreign-key check runs with RLS bypassed. So a policy that checks only the
row's own `user_id` still lets a signed-in user, calling PostgREST directly
with their own token, insert a row that **points at another user's record**.
The pointing row needs the other user's UUID, which is random v4 and is never
shown across accounts. That makes this hard to exploit, but the brief's rule
is "prove it filters", and these columns do not.

| Column | Guarded? |
|---|---|
| trade_folders.trade_id / folder_id | yes, policy (0028) |
| trade_strategies.trade_id / strategy_id | yes, policy (0028) |
| ai_messages.conversation_id | yes, policy (0048) |
| trades.commission_rule_id | yes, trigger (0056) |
| **monthly_cost_postings.cost_id / transaction_id** | **no** (open item in `docs/design-audit.md`) |
| **trade_history.trade_id** | **no** |
| **trade_images.trade_id** | **no** |
| **ai_reviews.trade_id** | **no** |
| **trade_excursions.trade_id** | **no**. It is also the primary key, so a foreign row could block the owner's own excursion row. |
| **strategy_rules.strategy_id** | **no** |
| **field_definitions.strategy_id** (0017) | **no** |
| **ai_conversations.key_id** | **no** |

Phase 1 closes all of these with one migration (0059) that adds owner-check
triggers, following the 0056 pattern.

## Environment variables (names only)

- **Browser-visible:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_SENTRY_DSN`.
- **Server only:** read through `serverSecret()` from `server-only` modules: `SUPABASE_SERVICE_ROLE_KEY`, `AI_KEY_ENCRYPTION_SECRET`, `AI_KEY_ENCRYPTION_SECRET_PREVIOUS`, `CRON_SECRET`, `AI_KEY_WRITE_V3`, `CSP_REPORT_ONLY`, `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`.
- **Scripts / e2e:** `TJ_TEST_EMAIL`, `TJ_TEST_PASSWORD`.

No secret name starts with `NEXT_PUBLIC_`. No client component imports a
secret: the one grep hit, `src/lib/ai-keys/crypto.ts`, is a comment and the
file imports `server-only`.

## The brief vs. what is already true

The brief was written without this repo's history. Each item it lists, against
the code today:

| Brief item | Status | Evidence |
|---|---|---|
| CSP is Report-Only | **Already enforcing** (since 2026-09-14) | `src/proxy.ts`; `CSP_REPORT_ONLY=true` is the rollback switch |
| Rate limiting is per warm instance | **Already global** | `src/lib/rate-limit.ts` → Postgres `rate_limit_hit` (0042). The stale comments at `proxy.ts:137,157` still say otherwise. |
| No CAPTCHA on auth | **Done**: Turnstile on sign-in, sign-up and forgot-password | `src/components/turnstile.tsx`, live since 2026-09-08 |
| HSTS, nosniff, Referrer-Policy, frame-ancestors / XFO, Permissions-Policy | **Done** | `next.config.ts:28-55`, CSP `frame-ancestors 'none'` |
| CORS: own origin only | **Done** | No `Access-Control-*` headers are sent anywhere |
| CSRF | **Done** | `isCrossSite` in `proxy.ts`, plus `SameSite=Lax` pinned |
| Google-hosted fonts | **Not an issue** | `next/font` self-hosts at build time. The CSP `font-src` is `'self'`. |
| Session replay | **Off** | Sentry `replaysSessionSampleRate: 0`, `replaysOnErrorSampleRate: 0` |
| `dangerouslySetInnerHTML` | **Safe** | 4 uses, all constant scripts or escaped JSON-LD |
| CSV formula injection | **Done** | `src/lib/trades/export.ts:50-66`, `src/lib/waitlist/csv.ts:20` |
| Raw SQL injection | **None** | No string-built SQL. RPCs take typed parameters. |
| `.env*` in `.gitignore`, example file | **Done** | `.gitignore:37`; `.env.local.example` tracked |
| Admin area server-side check | **Done** per page | Each `/admin/*` page calls `isAdmin()`, and the RPCs re-check |
| `user_settings.plan` not user-writable | **Done** | Column grants (0029); proven live 2026-09-13 (42501) |
| Migration numbering "after 0039" | **Out of date** | The repo is at 0058. New ones start at **0059**. |
| ~49 routes | **Out of date** | 65 handlers |

### Real gaps, mapped to phases

| Gap | Phase |
|---|---|
| 8 unguarded cross-user foreign keys (table above) | 1 |
| No user-A-vs-user-B test suite | 1 (runs on the new dev Supabase project) |
| Login limit 5 per 15 min | 2: Supabase dashboard setting plus runbook steps (sign-in goes from the browser straight to Supabase) |
| No daily caps on the costly routes; `Retry-After: 0` possible; no general body-size cap | 2 |
| Secret scan of the full git history; no secret check in CI | 3 |
| Demo password default hardcoded in `scripts/seed-demo-account.mjs:51` | 3 |
| zod missing on 11 routes | 4 |
| GIF branch stores raw bytes; bucket has no size/MIME limit; 1-hour signed URLs | 4 |
| No single role module (`plan` and `is_admin` are separate flags) | 5 |
| No age/consent checkbox at sign-up | Part B |
| Privacy page doesn't name Netlify, Cloudflare or Yahoo; contradicts itself on OCR | Part B |
| Data export covers trades only | Part B |
| Seed scripts and e2e use the production project, with no guard | Final task (moves to the dev project) |

## Phase 1 results (2026-10-09)

- **Migration 0059** adds owner-check triggers on all 8 unguarded foreign keys
  above, with one shared function (`enforce_fk_owner`). Proven on the dev
  project: every cross-user link is refused with 42501, and the user's own
  links still work. Verified separately in a local Postgres: demo-journal
  seeding, trade edits and the history trigger still work.
- **Two route answers fixed** (no data leaked from either; both answered wrongly):
  - `GET /api/trades/[id]/history` returned `200 []` for a trade that isn't
    yours. It now returns 404, and a malformed id is also 404.
  - `PATCH /api/strategies/[id]` reported every error as "a strategy with
    that name already exists" (400), including "not yours". Now: no row is
    404, a real name clash is 400, anything else is 500.
- **Cross-user suite:** `npm run test:idor`, 165 tests, against the DEV
  Supabase project only (`tests/idor/env.ts` refuses the production URL).
  - `postgrest.idor.test.ts`: user A, holding their own JWT, reads, updates
    and deletes B's rows in 18 tables; writes as B; links to B's records;
    reaches B's storage files; tries admin RPCs and service-only tables.
  - `routes.idor.test.ts`: the real handlers for every id-taking route,
    aimed at B's record (must be 403/404, echo nothing of B, and leave B's
    row byte-identical) and at A's own record (must succeed). Also covers
    A's record with B's ids mixed into the body, the admin routes, and
    no session at all.
- **Dev project setup:** `npm run dev-schema` builds `supabase/dev/schema.sql`
  from the migrations. A unit test fails if that file drifts from them.

## Phase 4 results (2026-10-09)

- **Input schemas:** every route that takes input now validates it with zod,
  or with an equivalent allowlist (market-data `bars` and `fx`). Routes moved
  from hand-written checks to zod: field-definitions (POST, PATCH),
  settings/core-fields, dashboard-layout, timezone (must be a real IANA zone),
  tour, trades/[id]/folders, trades/[id]/strategies, demo, and the outer shape
  of trades/[id] PATCH. market-data/candles gained the same symbol rule as bars.
- **Bugs this found:**
  - Editing a custom field from the Fields page was always refused: the
    client sends `options: { choices }`, but the old check wanted a bare array.
  - `PUT trades/[id]/folders` and `/strategies` read a missing or malformed
    list as `[]` and removed every link.
  - `core-fields` read the string `"false"` as true.
- **Uploads:** the screenshot upload and the OCR read go by the file's
  first bytes (`src/lib/images/magic.ts`), not its declared type. An SVG or
  HTML page labelled `image/gif` is refused; a PNG saved as `.jpg` still works.
  GIFs must also decode as GIF. Migration **0060** gives the `trade-images`
  bucket its own limits (10 MB; jpeg/png/webp/gif), so a direct Storage
  upload can't skip the route.
- **Signed URLs stay at 1 hour** (the plan said 10 minutes). The trade page
  lazy-loads screenshots, so a 10-minute link turns into a broken image for
  anyone who spends a while on the notes before scrolling down. A shorter TTL
  needs a URL refresh first; listed in the audit report.
- **Database functions:** every `security definer` function either checks
  `is_admin`, takes the user from `auth.uid()`, is granted to `service_role`
  only, or is the allowlisted public page-view counter. No string-built SQL.
- **AI:** all 13 chat tools are read-only (no insert, update, delete or rpc).
  Answers render as text with no links or images, so injected instructions in
  notes or screenshots can mislead an answer but cannot act.
- **Formula injection in exports:** already escaped (CSV); XLSX writes typed
  string cells.
- **Tests:** `tests/idor/validation.idor.test.ts`, 126 cases. Malformed JSON
  and wrongly shaped bodies get 400 on all 39 JSON routes; non-multipart and
  SVG-as-GIF uploads get 400 on all 3 upload routes; the real proxy answers
  413 to an oversized body on every one of those paths.

## Phase 5 results (2026-10-09)

- **Roles in one place:** `src/lib/auth/roles.ts` defines `user | paid |
  admin` and reads them fail-closed. `isPaidUser()`, `isAdmin()` and the
  root layout's Admin link all go through it.
- **Admin backstop:** `src/app/admin/layout.tsx` redirects non-admins on any
  `/admin` load. Every page still runs its own check, because Next doesn't
  re-run a layout on client-side navigation.
  `src/app/admin/admin-gates.test.ts` fails if an admin page or admin route
  ever lacks `isAdmin()`.
- **Session cookies:** one shared setting (`src/lib/supabase/cookie-options.ts`):
  SameSite=Lax as before, now also **Secure in production** (the library
  default left it off). Deliberately not httpOnly: the browser Supabase client
  reads the session from them, so the enforcing CSP is the control against
  XSS reading them.
- **Headers, verified on a local production server (`next start`):**
  - HSTS (2 years, preload), nosniff, X-Frame-Options DENY,
    Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy, COOP
    same-origin.
  - Enforcing CSP with a per-request nonce.
  - A cross-site POST to `/api` gets 403; a same-origin POST with no session
    gets 401; a cross-origin preflight gets no `Access-Control-*` headers.
- **Tokens in URLs:** only the single-use `token_hash` in emailed auth links
  (Supabase's standard flow, consumed by `/auth/confirm`). No session or API
  token ever travels in a URL.
