# Security runbook — operator steps

These are the security hardening steps that **cannot live in the codebase** —
they're settings in the Supabase and Netlify dashboards, and one migration to
apply. Each pairs with a code change already merged; the code is safe to ship
without these (nothing breaks), and applying each one is what lifts the matching
grade to A+. Do them in any order; each has a "confirm it worked" check.

Written September 2026. Companion to `SECURITY.md`.

---

## 1. Supabase auth rate limits  → lifts §1 (Authentication)

The sign-in / sign-up / reset endpoints are called by the browser directly
against Supabase, so a limit can only be set at Supabase's edge, not in our
code (see `SECURITY.md §1`).

**Supabase dashboard → Authentication → Rate Limits:**

| Limit | Set to |
| --- | --- |
| Sign-in / token grants (per IP, 5 min) | **5** (was 30; hardening brief 2026-10-09 asks for 5 per 15 min, and 5 per 5 min is the closest Supabase allows) |
| Sign-ups (per IP, hour) | 10 |
| Password recovery emails (per hour) | 10 |
| Confirmation / magic-link emails (per hour) | 10 |
| Verification attempts (per 5 min) | 30 |
| Token refreshes | leave default |

**Confirm:** attempt 6 quick failed sign-ins from one browser (wrong password,
solving the security check each time) → the 6th should be refused and you
should start getting rate-limited (the UI shows a "wait and try again" message, which
`src/lib/auth/error-messages.ts` already maps).

## 2. Minimum password length  → lifts §1 · DONE

**Supabase dashboard → Authentication → Providers → Email → Password
Requirements:** minimum length set to **8**, matching the `minLength=8` the
sign-up and reset forms now enforce client-side (already merged), so the
server agrees instead of rejecting an 8-char form value against a stale 6.

**Confirm:** a 7-character password is refused. ✅ Already applied.

### Leaked-password protection (HaveIBeenPwned) — blocked by plan tier, not by you

This toggle lives in the same panel but **only appears on Supabase's Pro plan
and above** — the free tier doesn't expose it at all, which is why it wasn't
visible. Nothing to apply here unless you upgrade:

- **Staying on the free tier:** leave it. §1 still reaches A+ without it — the
  auth rate limits (step 1) and the 8-character minimum already cover the two
  realistic attack paths (credential stuffing, weak passwords); the HIBP check
  is one more layer, not a hole on its own.
- **If you upgrade to Pro later:** Authentication → Providers → Email →
  Password Requirements → enable "Prevent use of leaked passwords". Confirm by
  attempting to set the password `password` — sign-up should be refused.

## 3. Encryption secret in Netlify  → lifts §3 (Secrets)

The AI-key encryption secret exists locally but must also be set in production,
byte-identical, or provider keys saved in one environment can't be decrypted in
the other. The route already fails safe if it's missing (it refuses rather than
leaking), so this is about making the feature *work* in prod, securely.

**Netlify dashboard → Site configuration → Environment variables:**

- Add `AI_KEY_ENCRYPTION_SECRET` with the **exact** value from your local
  `.env.local` (copy it verbatim — a different value orphans every stored key).
- Redeploy so functions pick it up.

**Confirm:** locally, `npm run verify:ai-secret` passes. In prod, save a
provider key on `/ask` and ask one question — it should work end to end.

## 4. Shorter JWT lifetime  → lifts §2 (Sessions)

After logout the app's session is revoked immediately, but a *raw copied access
token* stays valid against Supabase directly until it expires. Shortening the
token lifetime shrinks that window.

**Supabase dashboard → Authentication → Sessions (JWT expiry):**

- Lower **Access token expiry** from `3600` to `1800` seconds (30 min). Trade-off:
  the browser refreshes twice as often — invisible to users, negligible cost.

**Confirm:** sign in, then check the session — the access token's `exp` is ~30
min out. (Refresh continues to work; only the raw-token window shrank.)

## 5. Apply migration 0042 (+ confirm 0041)  → lifts §8 (Rate limiting)

The global rate limiter is backed by a Postgres counter. Until this migration
is applied the limiter **fails open** (allows everything) — safe, but not the
global ceiling you want.

**Supabase dashboard → SQL Editor:**

- Paste and run `supabase/migrations/0042_rate_limit_counters.sql`.
- (If not already done) also run `0041_more_free_ai_providers.sql`.

**Confirm:** `npm run migrations:status` reports nothing pending. Optionally
tell me once it's applied and I'll run a live check that the counter allows N
requests then blocks the N+1 with a sane `Retry-After`, the same way I verified
0041.

---

## 6. Lock down users' API keys (after the 2026-09-30 security pass deploys)

Four steps, **in this order**. Order matters because your local app and the
live site share one database: each step needs the code before it to be live
first, or the live site stops being able to save or use keys.

1. **Deploy** the branch with `src/lib/ai-keys/vault.ts` in it.
   - Netlify needs `SUPABASE_SERVICE_ROLE_KEY` set (it already is: admin
     pages and the cron use it).
   - *Confirm:* on the live site, ask one question on /ask with a saved key.
2. **Apply `supabase/migrations/0058_lock_down_api_keys.sql`** in the
   Supabase SQL editor.
   - *Confirm:* `npm run migrations:status` shows nothing pending, and /ask
     still answers on the live site.
3. **Turn on the bound (`v3`) format.** Set `AI_KEY_WRITE_V3` to `true`:
   - in Netlify (Site configuration → Environment variables), then redeploy;
   - in your local `.env.local`, then restart `npm run dev`.
4. **Upgrade every stored key now:** run `npm run rotate:ai-keys` (dry run,
   prints counts only), then `npm run rotate:ai-keys -- --apply`.
   - *Confirm:* a second dry run says every key is already current.

### Recommended once: rotate the encryption secret

`AI_KEY_ENCRYPTION_SECRET` sat in Netlify's saved build cache until the
build cache was switched off (`next.config.ts`). Nothing shows it was read,
but rotating makes that cache worthless:

1. In Netlify, open **Deploys → Trigger deploy → Clear cache and deploy site**
   once, to drop the old saved cache.
2. Generate a new secret: `openssl rand -base64 32`.
3. Set `AI_KEY_ENCRYPTION_SECRET_PREVIOUS` to the **old** value and
   `AI_KEY_ENCRYPTION_SECRET` to the new one, in Netlify **and** in
   `.env.local` (they must match, byte for byte).
4. Redeploy, then run `npm run verify:ai-secret` and
   `npm run rotate:ai-keys -- --apply`.
5. When a dry run says every key is current, delete
   `AI_KEY_ENCRYPTION_SECRET_PREVIOUS` from both places.

Rotating `CRON_SECRET` at the same time is cheap (it was in the same cache):
set a new value in Netlify and redeploy. Its only caller is
`netlify/functions/auto-execute-cron.mts`, which reads the same variable.

---

### Grade dependency, at a glance

| Section | Reaches A+ when |
| --- | --- |
| §1 Authentication | step 1 applied + step 2's min-length half (done) — leaked-password check is Pro-plan-gated, not required for A+ on free tier |
| §2 Sessions | step 4 applied (code already strong) |
| §3 Secrets | step 3 applied |
| §8 Rate limiting | step 5 applied (code already merged) |
| §7 CSP, §10 Ops | already done in code — no operator step |
