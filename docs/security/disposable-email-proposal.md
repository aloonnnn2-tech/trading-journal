# Disposable email addresses: proposal (open question Q3)

From the security gaps pass, item 5.5 ([02-gaps-report.md](02-gaps-report.md)).
**Nothing here is built.** It waits for Alon's decision.

## The situation (2026-10-18)

- Email confirmation is **on**, so every account needs an inbox that
  receives mail. A throwaway inbox (Mailinator, 10minutemail, and so on)
  still passes that.
- Live has 11 accounts, all signing in by email. One is unconfirmed, and
  none look like throwaway sign-ups (`npm run accounts:summary`).
- Sign-up runs **in the browser**, straight to Supabase. Our server never
  sees the address, so a block written in our code could be skipped by
  calling Supabase directly. A real block has to sit where the account is
  created: in Supabase, or on our server once Phase 1b moves sign-in and
  sign-up there.

## What a disposable address costs us today

Little. Each account is capped (screenshots, rows, AI, OCR and imports per
day: `src/lib/limits.ts`, `src/lib/rate-limits/daily.ts`), and sign-up has
CAPTCHA and Supabase's own rate limits. A disposable address gives someone
one more capped account, not a bigger one. The real cost is in the counts
on the admin pages, and in a free tier shared across more accounts.

## Options

| | Option | Work | Catches | Downside |
|---|---|---|---|---|
| A | **Do nothing now** (recommended while the user base is small) | none | — | The admin counts include the odd throwaway account; the stale-unconfirmed cleanup (`supabase/cleanup/0002_*`) removes the ones never confirmed |
| B | A small blocklist (about 50 big disposable domains) in the sign-up form | small | casual use | **Bypassable**: the form is in the browser. Only a speed bump |
| C | The same blocklist, enforced on the server, **after Phase 1b** moves sign-up to the server | small, once 1b is done | casual use, not bypassable | The list goes stale; new services appear daily |
| D | Supabase's "before user created" auth hook calling a check | medium | the same as C | Depends on what your Supabase plan includes. Check the dashboard (Authentication → Hooks) before choosing this |

No option needs a paid service. A hosted "is this address disposable" API
would, so it isn't listed.

## Recommendation

**A now, C with Phase 1b** if throwaway accounts ever show up in
`npm run accounts:summary` or the admin pages. B alone isn't worth its
upkeep, because anyone it would stop can step around it.
