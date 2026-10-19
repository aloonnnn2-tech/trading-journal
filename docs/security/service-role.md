# The service-role key: where it is, who uses it, how to rotate it

From the security gaps pass, item 6.3 ([02-gaps-report.md](02-gaps-report.md)).
Checked 2026-10-18. **Nothing was rotated.**

The service-role key skips every row-level security policy: whoever holds it
can read and change every user's data. It is the one secret whose leak is a
breach on its own.

## Where the key lives

| Place | Why | Notes |
|---|---|---|
| Netlify env `SUPABASE_SERVICE_ROLE_KEY` | The running app | Scope it to Production only ([netlify-checklist.md](netlify-checklist.md), G-10, not yet confirmed) |
| GitHub Actions secret `SUPABASE_SERVICE_ROLE_KEY` | The nightly backup (`.github/workflows/backup.yml`) | CI (`ci.yml`) uses a **placeholder**, not the key |
| `.env.local` on Alon's PC | Local scripts (backup, restore, account lists, migrations status) | Gitignored. **Also what `npm run dev` uses, so local dev talks to live** (`docs/dev-accounts.md`) |
| `flip.tmp.mjs`, `seed39.tmp.mjs` at the repo root | Old one-off scripts | Gitignored (`*.tmp.mjs`) and unused. **Recommended: delete them** |

The dev project's key (`.env.test.local`, `SUPABASE_DEV_SERVICE_ROLE_KEY`)
is a different key, for a project with test data only.

Today it is the legacy JWT form (`eyJ…`). Supabase now also issues
`sb_secret_…` keys. The log and Sentry scrubber redacts both
(`src/lib/observability/scrub.ts`; the `sb_secret_` rule was added in this
phase, so a rotation to the new form doesn't put it in logs).

## Never in the browser, never in logs

- Read in exactly three places in `src/`:
  - `src/lib/supabase/admin.ts`, which carries `server-only`, so a client
    import fails the build;
  - `src/lib/rate-limit.ts` (`server-only`);
  - `src/lib/env/required.ts`, which only checks that the key is set.

  (`src/lib/ai-keys/vault.ts` and two admin pages only *name* the variable
  in an error message.)
- No `NEXT_PUBLIC_` variable holds it. `npm run check:bundle` fails if its
  value, or any server-only value, appears in the built browser files. It
  runs in CI with placeholders, and locally against the real values (fixed
  in Phase 3, G-3).
- Logs: `log.ts` redacts fields named like secrets, and the scrubber
  redacts JWT and `sb_secret_` shapes. The backup workflow prints table
  names only.

## Every server file that uses it, and why

All of these go through `createAdminClient()`. Every call filters by the
user id the proxy verified, never by an id from the request body.

| File | Why it needs to skip RLS |
|---|---|
| `src/app/api/account/delete/route.ts` | Deletes the auth user and the user's Storage folder, removes their waitlist row, writes the audit entry |
| `src/app/api/account/export/route.ts` | The sign-in record (`auth.users`) and the analytics rows, which users can't read (0066) |
| `src/app/api/account/consent/route.ts` | Records the age and terms consent in `user_settings` columns users may not write themselves |
| `src/app/api/trades/[id]/images/route.ts` | Uploads to Storage: users lost direct write access in 0073 (G-2) |
| `src/app/api/waitlist/route.ts` | Inserts into `waitlist`, which has no user policies (signed-out visitors) |
| `src/app/api/analytics/public-view/route.ts` | Bumps the anonymous homepage counter (no user) |
| `src/app/api/reviews/prompt/route.ts` | Reads the user's own session counts from `analytics_sessions` (no user read policy) |
| `src/app/api/cron/auto-execute/route.ts` | The scheduled sweep across every user's open orders (no user session; gated by `CRON_SECRET`) |
| `src/app/api/health/ready/route.ts` | One row of `schema_migrations`, to prove the database answers |
| `src/app/api/admin/plan/route.ts`, `src/app/api/admin/waitlist/route.ts`, `src/app/admin/plans/page.tsx`, `src/app/admin/waitlist/page.tsx`, `src/lib/settings/admin-queries.ts` | Admin pages: other users' plans, the user list, the waitlist. Behind `isAdmin`, audited (0072) |
| `src/lib/admin/audit.ts` | Writes `admin_audit_log`, which no user role can touch |
| `src/lib/ai-keys/vault.ts` | The only reader and writer of encrypted AI keys: 0058 took that column away from users |
| `src/lib/http/idempotency.ts` | `idempotency_keys` (0069), server-only by design |
| `src/lib/tracking/log.ts` | Writes analytics events: users lost direct writes in 0066 |
| `src/lib/rate-limit.ts` | The `rate_limit_hit` counter: anon and users lost access in 0073 (G-1) |

Scripts (run by hand, or by the backup workflow; never deployed):
`backup-db`, `restore-db`, `restore-storage`, `restore-auth`,
`list-accounts`, `accounts-summary`, `migrations-status`, `rotate-ai-keys`,
`check-cache-secrets`, `seed-demo-account`, `set-demo-password`,
`capture-marketing-shots`. The test suites (`tests/idor`, `e2e`) use the
**dev** key only (`src/lib/env/dev-project.ts` refuses the live project).

## Rotating it (what breaks, in what order)

Do this if the key leaks, or if someone who had it leaves. The short version
is also in `docs/runbook.md` §4.

1. **Supabase → Project Settings → API Keys:** create the new secret key.
   Don't revoke the old one yet: with two valid keys, nothing is down while
   you swap.
2. **Netlify:** set `SUPABASE_SERVICE_ROLE_KEY` to the new value, then
   **trigger a redeploy**. Functions only read env at deploy time. Until
   the redeploy finishes, the old key is still in use, which is fine
   because it still works.
3. **GitHub → Settings → Secrets → Actions:** update
   `SUPABASE_SERVICE_ROLE_KEY`. Run "Backup database" by hand (Actions →
   Run workflow) to prove it.
4. **`.env.local`** on your PC: replace the value. Check with
   `npm run migrations:status`.
5. Check live: `/api/health/ready` returns OK, and a screenshot upload works.
6. **Now revoke the old key** in Supabase. Anything still using it fails
   from this moment.

If you revoke first, or a step is missed, here is what fails until it's
fixed:

- account deletion, data export, consent, screenshot uploads, the waitlist
  form, admin pages, AI keys (add, use, test), the 5-minute order sweep,
  and health/ready;
- rate limiting fails **open** (requests allowed, not refused), and
  analytics events are dropped quietly;
- the nightly backup fails, and shows red in Actions.

Sessions are not affected: users stay signed in, because sign-in uses the
JWT signing key, not this one.
