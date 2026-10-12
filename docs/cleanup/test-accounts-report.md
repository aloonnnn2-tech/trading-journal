# Test accounts on the live project (2026-10-10)

The last task in the hardening brief: zero test or demo junk accounts on the
live project, and a guarantee that new ones can't appear. Listing done
read-only with `npm run accounts:list` on 2026-10-10.

## Result

| | Accounts |
|---|---|
| Found on live | **15** |
| Kept: owner + demo showcase | 3 |
| Kept: real users, untouched | 6 |
| **Test accounts to delete** | **6** |
| Deleted | **6**: Alon ran the script on 2026-10-10. `npm run accounts:list` now shows 9 accounts, test 0. |

**Zero test accounts on live since 2026-10-10**, and zero ownerless
screenshot files. The check query found 9 such files, and Alon deleted them
the same day. Afterwards Storage held 1 folder, the admin's, which matches
its 10 screenshot records. See "Leftover screenshot files" below.

## Leftover screenshot files

The check query (`0001_verify_test_accounts_gone.sql`) returned 9 files,
dated 2026-09-08 to 2026-09-22. Each one sits in a folder named after a user
that no longer exists. Checked read-only: no current user, trade, screenshot
record or analytics event refers to any of the 9 folders.

Where they came from: e2e ran against live in that period. The OCR import
spec saves a screenshot, and the fixture then deleted the throwaway user,
but user deletion doesn't remove Storage files. The fixture now deletes the
user's files first (`e2e/fixtures/test-user.ts`).

To remove them: in Storage → `trade-images` there are 10 top-level folders.
Keep `20817d8f-…` (the admin account, the only current user with
screenshots) and delete the other 9. Re-running the check query should then
return no rows.

## The 6 test accounts

Their addresses are shown in full because none of them is a person's
address: one is on a reserved test domain, and five are on the app's own
domain, where only scripts ever signed up.

| Id | Email | Created | Last sign-in | Holds | Where it came from |
|---|---|---|---|---|---|
| `33483ef7…` | `demo+1783024871792@caliunlock-demo.test` | 2026-07-02 | 2026-08-13 | 53 trades, 482 events, **7 screenshots in Storage** (819 rows) | `scripts/seed-fake-data.mjs` run with no arguments: it signed a new account up on whatever project `.env.local` named, which was production. Its password was the script's default, `DemoPass123!`, written in the public repo. |
| `bf7b2da4…` | `tour-check-1@tradinglens.app` | 2026-09-29 | 2026-09-29 | 61 trades (demo journal), 10 events | An ad-hoc verification script in an earlier Claude session (tour rebuild), created via the admin API on live and not deleted |
| `05f90d19…` | `tour-check-2@tradinglens.app` | 2026-09-29 | 2026-09-29 | 61 trades (demo journal), 32 events | Same |
| `46868a98…` | `tour-check-4@tradinglens.app` | 2026-10-07 | never | settings only | Same (tour rebuild, 2026-10-07) |
| `6a419cef…` | `demo-flow-yes@tradinglens.app` | 2026-09-29 | never | settings only | Same: a check of the "Start with a demo journal?" flow |
| `4b87cf48…` | `demo-flow-no@tradinglens.app` | 2026-09-29 | 2026-09-29 | 2 trades, 18 events | Same |

In total: 1,200 rows, 177 of them trades and 542 analytics events. The
evidence for "an earlier Claude session" is the session transcripts, which
contain the `createUser({ email, … email_confirm: true })` calls for these
addresses.

**Effect on the admin numbers.** The `.test` account was already excluded
from analytics, because 0044 excludes reserved test domains automatically.
The five `@tradinglens.app` accounts were **not**: today's admin user count
and activity include them. Deleting them corrects that. Their events go with
them (cascade).

## Kept

- **Owner:** `al***@gmail.com`, the admin, and `al***@gmail.com`, Alon's
  second account, used to test as a free user.
- **Demo showcase:** `de***@tradinglens.app` (`demo@tradinglens.app`). It is
  excluded from analytics. The seed script now sets that itself (see below).
- **6 real users,** on ordinary email addresses, created between 2026-08-03
  and 2026-10-09. None of them is touched, and none looks like a test
  account by the rules below. Two of them loaded the optional demo journal on
  day one, which is why they hold ~60 trades. If any of the six is in fact
  yours from testing, say which and it goes into a second script.

## How accounts were sorted

`src/lib/accounts/classify.ts`, unit-tested:

| Group | Rule |
|---|---|
| keep | the three addresses above, exactly |
| test | a reserved test domain (`.test`, `.invalid`, `.example`, `.localhost`, per RFC 2606), or the app's own domain apart from the demo account |
| check | looks like a test account (`test…@`, mailinator, `example.com`, …) but is on a real domain, so a person decides. **0 found.** |
| real | everything else; never deleted |

No pattern ever deletes anything. The script names each account by id, and
pairs each id with its exact email.

## Steps for Alon (live project)

1. **Screenshots first.** In the dashboard, open Storage → `trade-images`,
   select the folder `33483ef7-04b5-4e04-adcc-dc997292b6fa`, and delete it.
   Supabase doesn't allow deleting Storage files from SQL, and the script
   refuses to run while files remain, so no file is left without an owner.
2. **Delete the accounts.** Paste `supabase/cleanup/0001_delete_test_accounts.sql`
   into the SQL editor and run it. It expects "Deleted 6 test accounts".
   It deletes **nothing** and says why if any of these is true:
   - an account is gone or has a different email;
   - an account is an admin or on the paid plan;
   - files remain.
3. **Check.** Run `supabase/cleanup/0001_verify_test_accounts_gone.sql`. It
   should return **no rows**: no test-domain accounts, and no screenshot
   files left behind. Or, locally, `npm run accounts:list` should show
   `test 0`.

The script was tested on a local Postgres (PGlite) with these 6 accounts
plus kept ones. It deleted the 6 and their rows and left the rest. It
refused, deleting nothing, in four cases:
- files remaining;
- a changed email;
- an account already gone;
- an account switched to paid.

## Root cause

There was one Supabase project, shared by production, local development, the
seed scripts and e2e. Nothing stopped a script from creating users on it:

1. **`seed-fake-data.mjs`** signed up a new account on production whenever it
   ran without arguments.
2. **Ad-hoc verification scripts** (written in a scratchpad during earlier
   sessions, never in the repo) created accounts with the production
   service-role key and didn't delete them.
3. **e2e** ran against production. It deletes its users after each run, so
   none were left. But a killed run would leave one, and `auth.spec.ts` signs
   up through the real form.

## Prevention (this branch)

- **A dev Supabase project** for everything that creates accounts (decision
  2026-10-09). `src/lib/env/dev-project.ts` → `loadDevProject()` reads
  `.env.test.local` and throws in three cases:
  - the URL is production's;
  - it can't tell what production is;
  - a key is missing.
- **Used by:**
  - the cross-user tests (`tests/idor/env.ts`);
  - Playwright (`playwright.config.ts`). It always starts its own server on
    the dev project and never reuses a running one;
  - the e2e fixture, which checks again;
  - `seed-fake-data.mjs`, now `npm run seed:fake`, dev only, with no
    hardcoded password;
  - the new `npm run dev:devdb`, a dev server on the dev project for looking
    at seeded data.
- **A test that keeps it that way:** `src/lib/env/account-creators.test.ts`
  fails `npm test` if any file in `scripts/`, `e2e/` or `tests/` calls
  `createUser` or `signUp` without the guard. Two exceptions are written into
  the test: the demo seed, and the cross-user world, whose setup file guards
  it.
- **The demo account excludes itself:** `seed-demo-account.mjs` sets
  `excluded_from_analytics: true`. Before, it relied on 0044's one-off update
  for the original account's id.
- **`npm run accounts:list`** to re-check at any time (read-only).
- **[docs/dev-accounts.md](../dev-accounts.md)** covers the rule, the one-time
  dev-project setup, and what must never run against live.
- A standing instruction for future Claude sessions: never create accounts
  on the live project, including in scratchpad checks.

## Open

- **Dev project setting (Alon).** In the **dev** project, go to
  Authentication → Sign In / Providers → Email and turn **Confirm email off**,
  as production has it. Until then, the e2e sign-up test fails there:
  Supabase tries to email each sign-up, so it refuses the `.invalid` test
  addresses and rate-limits.
- **e2e on the dev project, run 2026-10-10 before that setting:**
  - 5 passed: sign-in failure paths, password reset, autosave (most).
  - The sign-up test failed, for the reason above.
  - The autosave blur-timing check failed at 583 ms against a 500 ms limit.
    That test is known to be flaky.
  - Both OCR import tests failed. They had been broken since 2026-09-28,
    when the "demo journal?" prompt was added and they never dismissed it.
    Fixed in this branch; not re-run yet.

  A full re-run is due once Confirm email is off.
- After step 3 comes back empty, the live project has zero test accounts.
