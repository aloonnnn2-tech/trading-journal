# Runbook

For when something is wrong with the live site (tradinglenz.netlify.app). On call: Alon. One person, so
this is ordered for "I just got a message that it's broken".

Related: `SECURITY-RUNBOOK.md` (dashboard settings, the AI-key secret), `SECURITY.md` (what protects what),
`docs/production-readiness.md` (why things are the way they are).

---

## 1. Where to look first

1. **Is it up?** Open `https://tradinglenz.netlify.app/api/health/ready`.
   - `{"status":"ok"}`: the app and the database are fine. Go to step 3.
   - `{"status":"unavailable"}` (503): the app can't reach Supabase. Go to step 2.
   - No answer or a Netlify error page: the deploy is broken. See section 2, "Roll back a deploy".
2. **Supabase:** <https://status.supabase.com>, then the project dashboard → Reports and Logs.
3. **Errors:** Sentry, project `trading-lens` in the `ll-team` org. Filter by the last hour; each error shows
   its route.
4. **Function logs:** Netlify → the site → Logs → Functions. Every server log line is JSON with an `event`
   name and a `requestId`. The response header `x-request-id` carries the same id, so a user's failing
   request can be found by it.
5. **Market data only?** Yahoo is unofficial. If charts say "temporarily unavailable", Yahoo is down or
   blocking. The app stops calling it for 30s at a time and recovers by itself.

## 2. Roll back a deploy

Netlify deploys are atomic, and every earlier deploy is kept.

1. Netlify → the site → **Deploys**.
2. Click the last deploy that worked (each one shows its commit).
3. **Publish deploy**. Live within seconds, no rebuild.
4. The next push to `main` deploys as usual and replaces the rollback. If a fix will take a while, use the
   deploy's option to lock publishing, and unlock once the fix is live.

**Database migrations don't roll back with a deploy.** They run forward only and are applied by hand
(`supabase/migrations/`, the `schema_migrations` ledger, `npm run migrations:status`). New migrations state
their own down step at the top (see `0069_idempotency_keys.sql`). Older ones that don't are irreversible
without a restore. Code is written to work before and after its migration, so rolling back code alone is
normally safe.

## 3. Restore data

The project is on Supabase **Free**: Supabase keeps **no backups** of it. The only copies are the encrypted
GitHub Actions backups (`.github/workflows/backup.yml`): daily, kept 30 days, and weekly, kept 90 days.

**Included since 2026-10-16:** the screenshots (Supabase Storage, the `trade-images` bucket).

**Included since 2026-10-19:** the account list (ids, emails, dates, sign-in method) and the waitlist.

**Not in any backup:** passwords, the schema, and page-view totals.

To restore (the steps the workflow header gives, verified in Git Bash on Windows):

1. GitHub → Actions → "Backup database" → the run you want → download the artifact, unzip.
2. `read -rs BACKUP_PASSPHRASE; printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --decrypt --passphrase-fd 0 trading-lens-backup-<stamp>.tar.gz.gpg > backup.tar.gz; unset BACKUP_PASSPHRASE`
   (`read -s` keeps the passphrase off the screen and out of your shell history)
3. `tar -xzf backup.tar.gz` gives `backups/<stamp>/*.json`.
4. `npm run restore:db -- --dir backups/<stamp>` is a dry run. Read its output, then add `-- --apply`.
5. Screenshots: `npm run restore:storage -- --dir backups/<stamp>`, then add `-- --apply`. It only uploads files
   that are missing and never overwrites one that is there.

Restore into the **same** project (bad migration, mass delete): the accounts still exist, so this just
works. Into a **new** project: paste `supabase/dev/schema.sql` (every migration), recreate the accounts by id with
`scripts/restore-auth.ts`, then restore. The tested, step-by-step version is the drill in
[docs/security/restore-test.md](security/restore-test.md); pass the new project's env file explicitly, never `.env.local`.

## 4. Rotating secrets

Nothing here has been rotated as part of this doc. What each one breaks:

| Secret | Where | Rotate when | What breaks while you do it |
|---|---|---|---|
| Supabase **secret / service_role key** | Supabase → Project Settings → API Keys; then Netlify env `SUPABASE_SERVICE_ROLE_KEY` and the GitHub secret of the same name (backups) | It leaked, or someone who had it left | Server features using it (rate limiting fails open, cron, account delete, analytics writes, health/ready) fail until Netlify has the new value and is redeployed. Update all three places, redeploy, then revoke the old key. |
| Supabase **anon / publishable key** | Same page; Netlify `NEXT_PUBLIC_SUPABASE_ANON_KEY` | It's public by design. Only rotate if Supabase asks | It's baked into the browser bundle: needs a rebuild. Open tabs keep the old one until reload. |
| Supabase **JWT signing key** | Project Settings → JWT Keys (create the new key, then rotate) | Suspected compromise | **Everyone is signed out** when the old key stops being accepted. Sessions refresh to the new key; expect a wave of sign-ins. |
| `AI_KEY_ENCRYPTION_SECRET` | Netlify env | Leaked | Follow `SECURITY-RUNBOOK.md` §6 ("rotate the encryption secret"): set `_PREVIOUS`, run `npm run rotate:ai-keys`, then remove it. Done wrong, users' stored AI keys become unreadable. |
| `CRON_SECRET` | Netlify env (the scheduled function reads the same variable) | Leaked | One sweep may fail between saving and redeploying. Nothing else. |
| `BACKUP_PASSPHRASE` | GitHub secret, plus your password manager | Leaked | Old artifacts stay encrypted with the old passphrase. Keep it until they expire (90 days). |
| Google OAuth client secret | Google Cloud → Clients; then Supabase → Sign In / Providers → Google | Leaked | "Continue with Google" fails until Supabase has the new one. Email sign-in is unaffected. |

## 5. Uptime alert (free)

Not set up yet. To set it up (about 5 minutes, any free uptime service, e.g. UptimeRobot or Better Stack's
free tier):

1. Create a free account.
2. New monitor → type **HTTP(s)** → URL `https://tradinglenz.netlify.app/api/health/ready`.
3. Interval: 5 minutes (the free tiers' usual minimum; the endpoint allows 120 checks a minute app-wide).
4. Alert on: status not 200, or no answer in 30 seconds. Send to your email or phone.
5. Optional: a second monitor on `/api/health` (no database). If only `/ready` fails, it's Supabase.

## 6. Failure drills

Run these before a launch or after a big change. Each should end in a clear message, never a blank page or
a spinner that never stops.

| Drill | How | Expected |
|---|---|---|
| Yahoo down | Automated: `npx playwright test market-data-outage`. Manual: block `query1.finance.yahoo.com` in your hosts file, open a trade with a ticker | Chart: "Market data is temporarily unavailable…" with Try again. Trades still save. |
| Supabase slow or down | Point `NEXT_PUBLIC_SUPABASE_URL` at an unreachable host in `.env.local`, run `npm run dev` | `/api/health/ready` returns 503 within about 3s. Pages should show an error, not hang. A hang is a bug to file. |
| AI provider 500 | Add a key with a wrong value, or use a provider during an outage, and run an AI review | An error message on the panel, and the button comes back. The call is not retried automatically (it would bill the key again). |
| Offline browser | DevTools → Network → Offline, edit a trade | Badge: "Save failed". Saves itself when back online. AI and excursion buttons say "Couldn't reach Trading Lens" and come back. |
| Two tabs, same trade | Automated: `npx playwright test trade-conflict` | "Changed somewhere else" with Keep my change / Use the saved version. |
| Double click create | Click Add trade twice fast | One trade. |

## 7. After an incident

Write it up with `docs/postmortem-template.md`, even a short one. The point is the follow-up actions, not
the blame.
