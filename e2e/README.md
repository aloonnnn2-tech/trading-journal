# End-to-end tests

Playwright coverage for the three flows the 935 Vitest tests cannot reach.
Those are all pure logic — computation, parsing, validation, date maths. They
cannot see a debounce that stopped firing, a form that auto-fills with the
wrong value, or an auth screen that started rendering GoTrue's own error
wording. Those are the regressions that silently cost a user their trade data,
so they are what these cover.

| Spec | Flow |
| --- | --- |
| `auth.spec.ts` | sign up → sign out → sign in; wrong-password message; password-reset request |
| `trade-autosave.spec.ts` | create a trade, debounce, flush-on-blur, persistence, derived fields |
| `ocr-import.spec.ts` | screenshot upload → auto-fill → confidence badge → corrected value persists |

## Running them

```bash
npm run test:e2e          # all specs, headless
npm run test:e2e:ui       # Playwright's UI mode, for debugging
npx playwright test e2e/auth.spec.ts --retries=0   # one file, fail fast
```

`playwright.config.ts` starts `next dev` itself and reuses an already-running
server if you have one. First run against a cold server is slow — Next compiles
each route on first request — which is why the timeouts here look generous.

## What you need

Only `.env.local`, which you already have if the app runs. The config loads it
with `process.loadEnvFile`, and the tests need:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` — to create and delete their own throwaway users
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` — **also needed for local development
  generally.** Supabase enforces CAPTCHA project-wide, so a local build
  without this sends no token and every sign-in is rejected, on localhost as
  much as in production. The Turnstile widget's hostname list includes
  `localhost`, so the production site key works here too.

No seed data. Each run creates the users and trades it needs and deletes them
afterwards.

## These run against the real Supabase project

There is one project, shared with production. That is not ideal, and it is why
the suite is careful:

- **Every test user is created and deleted through the admin API**, never
  through the sign-up form, and every table cascades from `auth.users` — so
  deleting the user removes the trades, folders and strategies a test made.
- **Emails are `@tradinglens-e2e.invalid`.** `.invalid` is reserved by RFC 2606
  and can never resolve, so a stray confirmation or reset email has nowhere to
  go.
- **The demo account is never touched.** Pointing these at
  `demo@tradinglens.app` would corrupt the account that exists to show the app
  off, and leave residue after every run.

If a run is killed part-way, its user may survive. They are harmless and
obvious — search Supabase Auth for `tradinglens-e2e.invalid` and delete.

## Two things that will surprise you

**1. Sessions are established by magic link, not by the sign-in form.**
`fixtures/test-user.ts` mints a service-role magic link and feeds it through
the app's own `/auth/confirm` route, which is the same code path a real emailed
link takes.

That is not just for speed. **Once Turnstile is enabled in the Supabase
dashboard, browser-driven sign-in will need a valid CAPTCHA token** — and
Cloudflare's dummy sitekey only validates against the dummy *secret*, which
this project cannot use because it has one Supabase project and one secret,
shared with production. Service-role calls bypass CAPTCHA, so the autosave and
OCR specs keep working regardless.

`auth.spec.ts` is the exception: it drives the real form on purpose, because
that form is what it is testing. Once CAPTCHA is enforced those tests cannot
pass — an automated browser cannot mint a valid Turnstile token, because
Cloudflare's dummy sitekey only validates against the dummy *secret*, and this
project has one Supabase project sharing one secret with production.

**So `auth.spec.ts` skips itself when CAPTCHA is on**, with the reason printed
on each skipped test. It detects that by asking Supabase (a tokenless password
grant answers `captcha_failed`) rather than reading a checked-in flag — so if
CAPTCHA is ever switched off, the tests come back on their own instead of
staying silently disabled because nobody remembered to flip something.

A permanently three-red suite is a suite people stop reading, which is worse
than an honest skip. Fixing it properly needs a second Supabase project
configured with Turnstile's dummy secret.

**2. `trade-autosave.spec.ts` contradicts the brief that asked for it.**
That brief asked to verify "no premature save" when waiting past the debounce
without blurring. The app does not behave that way and should not:
`src/lib/trades/use-autosave-trade.ts` schedules a flush 600ms after the last
keystroke regardless of focus. An autosave that only wrote on blur would lose
everything typed by anyone who closed the tab with the cursor still in a field.
The spec asserts the real contract — debounce, *plus* an immediate flush on
blur — and says so in its own header.

## Notes for writing more

- **Don't use `getByRole("alert")`.** Next renders an always-present route
  announcer with that role, so it matches two elements and strict mode fails
  before your assertion runs. `FormError` renders `p[role="alert"]`.
- **Don't use `getByLabel("Password")`.** The sign-in label wraps a "Forgot
  password?" link, so its accessible name is `Password Forgot password?`.
  Locate password fields by `input[autocomplete="current-password"]` /
  `new-password`.
- **Dismiss the onboarding tour.** A fresh user gets an overlay on `/trades`
  that swallows clicks. Every helper here clicks "I'll explore on my own"
  first, tolerating its absence.
- **Let the trade page settle before counting requests.** It issues its own
  PATCH shortly after mount, which will otherwise be attributed to whatever
  you were measuring.
