# Test and dev accounts

**The rule: accounts for testing are never created on the live project.**
Everything that makes users (the cross-user tests, e2e, the fake-data seed)
runs against a separate free **dev** Supabase project, and refuses to start if
it is pointed at production.

The live project should hold three kinds of account and nothing else:

| Account | Why it's there |
|---|---|
| Real users | The product. |
| Alon's own (`alonilon2018@…` admin, `aloonnnn2@…`) | Owner and testing-as-a-user. |
| `demo@tradinglens.app` | The public showcase, built by `scripts/seed-demo-account.mjs`. The seed sets `excluded_from_analytics`, so it never counts as a user. |

To check what's there, run `npm run accounts:list`. It is read-only and
prints masked emails. It sorts every account into one of four groups:
- **keep:** the accounts in the table above, apart from real users;
- **test:** a cleanup candidate (see the rule below);
- **check:** looks like a test account on a real domain, so a person decides;
- **real:** never touched.

The rule for "test" is in `src/lib/accounts/classify.ts`: a reserved test
domain (`.test`, `.invalid`, `.example`, `.localhost`), or the app's own
domain other than the demo account.

## Setting up the dev project (once)

1. Create a free Supabase project. Use your own organisation; any region.
2. Build its schema:
   - run `npm run dev-schema`;
   - paste `supabase/dev/schema.sql` into the dev project's SQL editor.

   After a new migration, paste that migration there too.
3. In the dev project, go to **Authentication → Sign In / Providers → Email**
   and turn **Confirm email off**. This deliberately **differs** from
   production, which has confirmation ON (confirmed 2026-10-18). With it on,
   Supabase emails every sign-up, which means:
   - it refuses the test addresses (`.invalid` can't receive mail);
   - it rate-limits after a few sign-ups.
4. Leave CAPTCHA **off** on the dev project. The e2e sign-up test drives the
   real form, and no automated browser can solve a real CAPTCHA.
5. Put its keys in `.env.test.local`, which git ignores:

   ```
   SUPABASE_DEV_URL=https://<dev-ref>.supabase.co
   SUPABASE_DEV_ANON_KEY=...
   SUPABASE_DEV_SERVICE_ROLE_KEY=...
   ```

## What uses it

| Command | What it does on the dev project |
|---|---|
| `npm run test:idor` | Cross-user, validation, rate-limit, consent and export tests. Creates two users per run and deletes them. |
| `npm run test:e2e` | Starts its **own** `next dev` on :3100 pointed at the dev project. It never reuses a running server, because that one talks to production. Next 16 locks `.next/dev`, so stop your regular dev server first. |
| `npm run seed:fake` | A throwaway account with ~45 fake trades, for looking at the UI with data. |
| `npm run dev:devdb` | `next dev` on :3003 against the dev project, to look at seeded accounts or try sign-up without creating a real account. |
| `npm run dev` | **The LIVE database**, deliberately: plain `next dev` reads `.env.local`, which holds production's keys. It is how Alon checks a change against his real journal. Everything done there (edits, sign-ups, AI calls) is real. For anything throwaway, use `dev:devdb`. |

## How it is enforced

These pieces live in `src/lib/env/`:

- **`dev-project.ts` → `loadDevProject()`.** It reads `.env.test.local` and
  throws in three cases:
  - the URL is production's;
  - it can't tell what production is (fail closed);
  - a key is missing.

  From `.env.local` it reads only production's URL, and only so it knows
  what to refuse.
- **`dev-guard.ts` → `assertDevSupabase()`.** This is the check itself.
  `e2e/fixtures/test-user.ts` runs it again, so a fixture loaded some other
  way still can't create users on live.
- **`account-creators.test.ts`** (in `npm test`). It scans `scripts/`, `e2e/`
  and `tests/` for anything calling `createUser` or `signUp`. It fails unless
  that file uses the guard, or is on a short allowlist with a written reason.
  Today the allowlist holds the demo seed and the cross-user world, whose
  setup file guards it.

## Never, on the live project

- Don't sign up from a script, a test or a "quick check". This includes
  ad-hoc scripts in a scratchpad: the `tour-check-*` and `demo-flow-*`
  accounts found on 2026-10-10 came from exactly that.
- Don't run `e2e` against a server you started yourself. Its `.env.local`
  points at production.
- Don't delete accounts by pattern. Cleanup goes through an explicit-id
  script that Alon runs (see `supabase/cleanup/`).
