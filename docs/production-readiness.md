# Production readiness

The audit asked for by `01-production-readiness.md` (September 2026), done on 2026-10-16 against the code at
the time. One row per checklist item. **IMPLEMENT** = built in this pass. **VERIFY** = already there or
checked, with evidence. **N/A** = doesn't apply to Next.js on Netlify plus managed Supabase, with the reason.

Many items the brief listed as gaps were closed after it was written (enforced CSP, a global rate limiter,
CAPTCHA, the migrations ledger, backups). Those are VERIFY rows below.

Branches: `prod-ready/phase-1-security` … `prod-ready/phase-4-ops`, committed locally, not pushed.

## Phase 1 — Data safety and security

| # | Item | Disposition | Evidence | Fix or reason |
|---|---|---|---|---|
| 1 | IAM / RLS | VERIFY | All 28 tables in `supabase/migrations/` enable RLS. 24 have owner policies on `auth.uid()`. analytics_events/sessions are admin-read only (0066). schema_migrations, rate_limit_counters, public_page_views, waitlist and idempotency_keys have no policies and grant nothing to anon/authenticated. No `using (true)`. | `src/lib/supabase/admin.ts` is `server-only`. **Fixed:** `src/lib/rate-limit.ts` built its own service-role client without `server-only`; it has it now. |
| 2 | SQL / filter injection | VERIFY | No raw SQL in `src/`. Every `.rpc()` uses named parameters. The two `.or()` calls taking user text (`src/lib/trades/queries.ts` search and emotion) go through `quoteOrValue`. | Tests: `queries.search.test.ts` (existing). **Added:** hostile emotion tags in `queries.filters.test.ts`. |
| 3 | Secrets management | VERIFY | AI keys: AES-256-GCM bound to owner, row and provider (`src/lib/ai-keys/crypto.ts`), never selected into responses (`queries.ts` `BASE_COLUMNS`), `SecretKey` prints `[redacted]`. CI runs gitleaks over full history and `check-bundle-secrets`. | `.env.local.example` lists every variable the code reads (platform-set ones noted). |
| 4 | CSRF | VERIFY | `src/proxy.ts` `isCrossSite()` refuses cross-site non-GET `/api/*` (Sec-Fetch-Site, then Origin vs Host). Cookies `SameSite=Lax` (`cookie-options.ts`). `/auth/confirm/verify` has its own Origin check. | Tests in `src/proxy.test.ts`. A request with neither header passes by design: not a browser page, so not a CSRF vector. |
| 5 | CORS | VERIFY | No `Access-Control-*` header anywhere (`src/`, `next.config.ts`, `netlify.toml`). Same-origin only. | — |
| 6 | CSP | VERIFY | Enforced since 2026-09-14, nonce plus `strict-dynamic` (`src/proxy.ts`). `CSP_REPORT_ONLY=true` turns it back to report-only without a code change. Violations go to `/api/csp-report`. | **Fixed** a stale comment in `turnstile.tsx` that still called it report-only. |
| 7 | TLS / HSTS / headers | VERIFY | `next.config.ts` `headers()`: HSTS (2 years, includeSubDomains, preload), nosniff, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy, COOP. CSP `frame-ancestors 'none'`. | — |
| 8 | Encryption in transit / at rest | VERIFY | Transit: no `http://` outbound URL in `src/` or `netlify/`. Supabase APIs accept TLS 1.2/1.3 only. At rest: Supabase states "All customer data is encrypted at rest with AES-256" (supabase.com/security, checked 2026-10-16). It does not say whether backups are covered, so this doc doesn't claim it. | AI keys are also encrypted by the app (item 3). |
| 9 | OAuth | VERIFY | Enabled: email/password and Google (switched on 2026-10-16). `/auth/callback` sends to `afterSignIn()` (fixed allow-list). `/auth/confirm/verify` uses `safeDestination()` (origin compare). | The Redirect URL allow-list lives in the Supabase dashboard; check it has no wildcards (runbook). |
| 10 | JWT rotation | VERIFY → doc | — | Steps and what breaks: `docs/runbook.md` "Rotating secrets". Nothing rotated. |
| 11 | WAF / DDoS | N/A | — | Netlify absorbs network-level floods; Supabase fronts its own API. App-level defence is items 12 and 13. |
| 12 | Rate limiting | VERIFY | Global and database-backed: `rate_limit_hit` (0042) via `src/lib/rate-limit.ts`. Proxy baseline on all `/api/*`, per-route limits on AI, OCR, imports, exports and market data, daily caps (`src/lib/rate-limits/daily.ts`). 429 with Retry-After. Fails open, except AI-key checks (`failClosed`). | Sign-in/up/reset go straight to Supabase Auth: limited in its dashboard (`SECURITY.md` §1) plus CAPTCHA. **Added:** excursions and the cron sweep now count against the Yahoo ceiling. |
| 13 | CAPTCHA | VERIFY | Turnstile on sign-in, sign-up, forgot-password and resend (`src/components/turnstile.tsx`). | `/api/waitlist` has a honeypot plus IP limit, no CAPTCHA. Fine at its size. |

## Phase 2 — Database

| # | Item | Disposition | Evidence | Fix or reason |
|---|---|---|---|---|
| 14 | Migrations / versioning | VERIFY | `schema_migrations` ledger (0040), self-recorded by every migration since. `npm run migrations:status` (`scripts/migrations-status.ts`). Live ledger has **69 rows on 2026-10-16**, so 0000–0068 are applied. | New: `0069_idempotency_keys.sql`, **applied 2026-10-16** (ledger row present; table refuses the public key). |
| 15 | Indexing | VERIFY | `user_id` indexes on every user table. Perf indexes in `0065_perf_indexes.sql` (applied, per the ledger). Trigram indexes for search (0005). | No new index needed at current size (item 21 counts). |
| 16 | Query optimization | VERIFY | Heaviest reads: `dashboard_stats` RPC, the trade list (`filteredTradesQuery`), analytics (`segments/engine.ts` over `fetchAllRows`), export. | No timings invented. To measure: run the query with `explain (analyze, buffers)` in the SQL editor, or read Sentry's traces (item 54). |
| 17 | N+1 queries | VERIFY | Per-item loops: the cron sweep (per-user settings read, per-trade updates), `takeDueMonthlyCosts` (3–4 calls per due month), commission recalculate (per-trade update, 20 at a time), excursions (per symbol, Yahoo). | All bounded (one user's due months, one user's trades). Left as is at 11 accounts; noted for the PERF-2 RPC work. |
| 18 | PostgREST row cap | SKIP | Covered by C1 (`fetchAllRows`). | — |
| 19 | Connection pooling | VERIFY | No `pg`/`postgres`/ORM in `package.json`. Everything uses supabase-js over HTTP (pooled by Supabase). | — |
| 20 | Backups / DR | VERIFY → doc | Nightly and weekly encrypted dumps of 24 tables (`.github/workflows/backup.yml`, `scripts/backup-db.ts`), restore with `scripts/restore-db.ts`. Supabase: daily backups only on Pro (7 days) and above; **Free gets none**; never includes Storage files (docs, checked 2026-10-16). | Not backed up anywhere: screenshots (Storage), `auth.users`, schema, waitlist, public_page_views. Restore steps in the runbook. The project is on the **Free plan** (`backup.yml` header), so the GitHub backup is the only copy. |
| 21 | Replicas, sharding, multi-region… | N/A | Live row counts 2026-10-16: analytics_events 6,557; trade_history 578; trades 472; 11 accounts. | One Postgres handles this many thousand times over. Revisit when the largest table passes ~10 million rows or queries slow down in Sentry traces. |

## Phase 3 — Outbound calls

| # | Item | Disposition | Evidence | Fix or reason |
|---|---|---|---|---|
| 22 | Timeouts | IMPLEMENT | **New** `src/lib/http/resilient-fetch.ts`. Yahoo: 6s per attempt (it had none). AI providers: 10s validate, 22s ask/stream (`providerFetch`, existing). Cron trigger: 25s (`netlify/functions/auto-execute-cron.mts`). Health DB check: 3s. | Every outbound fetch now has a timeout. |
| 23 | Retries + backoff | IMPLEMENT | Yahoo: up to 3 attempts on network error/429/5xx, exponential backoff with full jitter, honours Retry-After up to 2s. | **AI calls are never auto-retried** (every provider bills the user's key per call). The one-time model-retired re-pick and JSON repair are deliberate and existing. |
| 24 | Circuit breaker | IMPLEMENT | `CircuitBreaker` in `resilient-fetch.ts`, on Yahoo: 5 failures in a row open it for 30s. Per serverless instance (accepted, noted in code). Outage now returns **503** "Market data is temporarily unavailable" with Try again in the chart, not a 404 blaming the symbol. | The chart shows "as of {Yahoo's quote time}", so a cached or delayed price never reads as live. e2e: `market-data-outage.spec.ts`. |
| 25 | Idempotency | IMPLEMENT | `src/lib/http/idempotency.ts` plus migration 0069 on create, duplicate, import and import-json. The page sends one key per action (`idempotency-key.ts`). | Tests: same key twice → one trade. Plus ref guards on every create button, `n` key repeat, and import (stays disabled after success). |
| 26 | Backpressure | IMPLEMENT (partial) | Per-user rate limits on OCR (20/min, 200/day), AI read (10/min), AI reviews (10/min); chat allows one turn per conversation. Buttons disable while running. | **Fixed:** three panels stayed disabled forever after a network error. Not built: a hard per-user concurrent cap. The rate limits already return 429 well before concurrency matters. |
| 27 | Failover | N/A | — | No second market-data source. Open question 3. |

## Phase 4 — Caching and delivery

| # | Item | Disposition | Evidence | Fix or reason |
|---|---|---|---|---|
| 28 | Caching | VERIFY | Every API GET gets `private, no-store` (`apiCacheControl` in `src/proxy.ts`); the chat stream sets its own. Market data: Next fetch cache, 5 min (1 day for settled ranges, 1 h for FX). That is public data, safe to share. | **Added test:** no signed-in API answer is publicly cacheable (`proxy.test.ts`). |
| 29 | Cache invalidation | VERIFY | No server cache of user data to invalidate. Pages are dynamic. After a write the page calls `router.refresh()`: commissions, fields/folders, strategies, import, AI review, history restore, suggestions, mode change, excursions, cash, period reviews, consent, demo. | — |
| 30 | CDN / edge | VERIFY | Static assets are hashed and cached by Netlify's CDN. Authenticated pages are dynamic (not edge-cached), and API answers are `no-store`. | — |
| 31 | Build caching | VERIFY | Netlify's Next.js runtime keeps `.next/cache` between builds (`SECRETS_SCAN_OMIT_PATHS` in `netlify.toml` covers it). | Build times not measured here. |
| 32 | Load balancing, autoscaling… | N/A | — | Netlify Functions scale per request; nothing to run. |

## Phase 5 — Concurrency and consistency

| # | Item | Disposition | Evidence | Fix or reason |
|---|---|---|---|---|
| 33 | Race conditions | IMPLEMENT | `updateTrade` read-merge-write now writes only `where updated_at = <read>` and re-merges if the row moved (`src/lib/trades/queries.ts`, `queries.concurrency.test.ts`). Autosave sends one save at a time. | Other read-modify-write paths (suggestions, field visibility, preferences) are single-user, low-frequency settings. Left as is. |
| 34 | Optimistic locking | IMPLEMENT | Autosave sends `base`; the PATCH returns **409** when the same field changed elsewhere (`src/lib/trades/conflicts.ts`). The trade page offers Keep my change / Use the saved version. | e2e: `trade-conflict.spec.ts`. |
| 35 | Offline / partitions | VERIFY → policy | Policy: **field-level merge, conflict prompt on the same field**. Edits to different fields merge. The same field changed elsewhere since this page last saw it asks the user. A page closed on a conflicting edit loses that edit rather than overwrite unseen. Offline: edits queue in memory, retry with backoff and on `online` (`use-autosave-trade.ts`). There is no persistent offline queue. | — |
| 36 | Clock skew | VERIFY | `updated_at` is set by a trigger with `now()` (0001). Conflict detection uses it, never a client clock. | — |
| 37 | Memory leaks | VERIFY | Every `addEventListener`/`setInterval`/`ResizeObserver` in `src/` has its cleanup (18 files checked). Server module state: formatter caches, a CSP-report map capped at 5,000, per-instance breaker. None holds per-user data. | **Changed:** the chart's price poll now skips while the tab is hidden. |
| 38 | Deadlocks / locks | VERIFY | Only `0051_demo_journal.sql` takes row locks (`for update` on the caller's own `user_settings` row). `rate_limit_hit` uses `on conflict`. | — |
| 39 | Thread safety / GC | N/A | — | Single-threaded JS. No module-level per-user state (item 37). |
| 40 | Distributed transactions | VERIFY | Multi-table writes that can half-fail: strategy/folder links (delete then insert), field reorder (two PATCHes), images (upload then row, with cleanup), monthly costs (with cleanup), account delete. **Fixed:** Quick trade and screenshot create were create + PATCH; the create now saves both or deletes the trade. | The remaining ones are low-impact and user-retryable. Candidates for RPCs if they ever misbehave. |

## Phase 6 — Async and messaging

| # | Item | Disposition | Evidence | Fix or reason |
|---|---|---|---|---|
| 41 | Queues / pub-sub / DLQ | N/A | — | Nothing outlives one request except the 15-minute sweep. Revisit if imports ever exceed the 60s function limit. |
| 42 | Cron | VERIFY | One job: the Netlify scheduled function every 15 min calls `/api/cron/auto-execute`. Cleanup is in-function: `rate_limit_hit` and `idempotency_keys` each prune about 1 call in 100. | No new cron needed. |
| 43 | Webhooks | N/A now | — | When Stripe arrives: verify the signature on the raw body, store the event id, and treat a repeat as a no-op (`withIdempotency` pattern). |
| 44 | Streaming | VERIFY | Chat streams (`/api/chat/conversations/[id]/turn`, maxDuration 26) pass `request.signal` and release the turn in `finally`. **Fixed:** AI reviews and screenshot-AI now pass `request.signal` too, so a closed tab stops the billed call. | — |

## Phase 7 — Deployment and release safety

| # | Item | Disposition | Evidence | Fix or reason |
|---|---|---|---|---|
| 45 | CI/CD | VERIFY | `.github/workflows/ci.yml`: npm audit (prod, high+), vitest, lint, build, bundle-secret check, gitleaks. **Added:** standalone `tsc --noEmit`. | e2e and `test:idor` need the dev project's secrets, so they run locally only. |
| 46 | Docker / K8s / IaC | N/A | — | `netlify.toml` is committed. Build settings live in the Netlify UI (noted in the file). No Dockerfile (open question 4). |
| 47 | Feature flags | VERIFY (override) | Env kill switches: `CSP_REPORT_ONLY`, `AI_KEY_WRITE_V3`. Design V2 via `?design=v2` (`src/components/design/design-flag.tsx`). Google sign-in follows the Supabase switch. | A generic flags helper would be dead code today. Add one with the first flag that needs a database override. |
| 48 | Rollback | VERIFY → doc | Netlify deploys are atomic; any earlier deploy can be published again. | Steps in the runbook. Migrations run forward only; each new one states its down step (0069 does). |
| 49 | Health checks | IMPLEMENT | `GET /api/health` (no DB) and `GET /api/health/ready` (one ledger row, 3s, 120/min app-wide). No version or detail. | e2e: `health.spec.ts`. |
| 50 | Versioning | VERIFY | No public API, so no API versioning. | **Added** `CHANGELOG.md`; `package.json` set to 0.2.0. |
| 51 | Dependencies | VERIFY | Lockfile committed. Dependabot weekly, grouped minor/patch and majors, Next/React majors ignored. CI fails on a high/critical prod advisory. | **Added** `.nvmrc` (24) and `engines` `>=24 <25`. Netlify will build with Node 24. |

## Phase 8 — Observability

| # | Item | Disposition | Evidence | Fix or reason |
|---|---|---|---|---|
| 52 | Logging | IMPLEMENT | **New** `src/lib/observability/log.ts`: JSON lines, level, time, request id, redaction of credentials, emails and journal content (tested). The 35 `console.*` calls in API routes and lib moved to it. | — |
| 53 | Tracing | IMPLEMENT (cheap) | The proxy sets a fresh `x-request-id` per request, on the request and the response. Every log line carries it. Sentry samples 10% of requests with traces. | — |
| 54 | Metrics | VERIFY (override) | Sentry performance (already installed, `src/instrumentation.ts`, 10% sampling) gives per-route throughput, error rate and latency percentiles. | Chosen over a new database table (Alon, 2026-10-16). |
| 55 | Alerts | DOC | — | Free uptime monitor on `/api/health/ready`: steps in the runbook. No account created. |
| 56 | SLIs / SLOs | DOC | SLIs: readiness availability, API 5xx rate, p95 of `GET /trades` page load. | Targets: **TBD — measure first** (from Sentry and the monitor). |
| 57 | Incidents / postmortems | DOC | — | `docs/runbook.md`, `docs/postmortem-template.md`. |

## Phase 9 — Performance and platform limits

| # | Item | Disposition | Evidence | Fix or reason |
|---|---|---|---|---|
| 58 | Latency / tail | VERIFY | Sentry traces (item 54). | No p50/p95/p99 figures in this doc until measured. |
| 59 | Cold starts | VERIFY | No AI SDKs (providers are plain `fetch`). Heavy deps: `sharp` (OCR, images), `exceljs` (xlsx, export). Paddle/Tesseract are dynamic imports. | Fine as is. |
| 60 | Serverless limits | VERIFY | Netlify (docs.netlify.com/build/functions/configuration, checked 2026-10-16): sync **60s**, scheduled **30s**, background 15 min; buffered body 6 MB, binary uploads about **4.5 MB** effective (Base64). | **Fixed:** uploads checked at 5 MB could exceed 4.5 MB and fail with a raw platform error. Now one 4 MB limit (`src/lib/http/upload-limits.ts`) with a clear message. The cron trigger stops waiting at 25s. maxDuration values (26–60) are within the 60s limit. |
| 61 | Cost | VERIFY | Yahoo: per-user, daily and app-wide caps (now covering excursions and cron). Uploads: 4 MB. Exports: rate-limited, fetch all of one user's trades (fine at 472 trades in total). Chart poll pauses when hidden. | — |
| 62 | DNS / HTTP versions / gRPC | N/A | — | Netlify negotiates HTTP/2 and HTTP/3 and runs DNS; no gRPC. |
| 63 | Chaos engineering | DOC | — | Manual failure drills in the runbook. Yahoo-down and conflict drills are automated (e2e). |

## Open questions for Alon

1. **Screenshots have no backup anywhere.** The project is on Supabase Free (no Supabase backups), and the GitHub
   backup covers the database only. Back up the `trade-images` bucket too, or accept the risk?
   protection relies on the button guards only.
3. A fallback market-data source besides Yahoo? Default: no.
4. A Dockerfile for local dev? Default: no.
5. Node 24 on Netlify (from `.nvmrc`): the first deploy after merge will build with it. CI already did.
