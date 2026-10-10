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

`playwright.config.ts` starts its **own** `next dev` on port 3100 (or
`E2E_PORT`), pointed at the dev Supabase project. It never reuses a server
that's already running: yours reads `.env.local`, so it talks to production,
and the sign-up test would make a real account there. Next 16 locks
`.next/dev`, so **stop your regular dev server first**. If you forget, Next
says so and exits.

The first run against a cold server is slow, because Next compiles each route
on its first request. That's why the timeouts here look generous.

## What you need

`.env.test.local` with the **dev** project's keys. The one-time setup is in
[docs/dev-accounts.md](../docs/dev-accounts.md). Two settings there matter
for e2e:
- **Confirm email** must be off;
- CAPTCHA must be off.

The config refuses to run if those keys name the production project. It
loads nothing else from `.env.local` except production's URL, which it reads
only so it knows what to refuse.

On top of the dev keys, the test server gets:
- Cloudflare's published always-pass Turnstile test sitekey
  (`1x00000000000000000000AA`);
- a throwaway AI-key encryption secret.

No seed data. Each run creates the users and trades it needs and deletes them
afterwards.

## Throwaway users, deleted afterwards

- **Every test user is created and deleted through the admin API.** The
  exception is `auth.spec.ts`, which signs up through the form because the
  form is what it tests. Every table cascades from `auth.users`, so deleting
  the user removes the trades, folders and strategies a test made.
- **Emails are `@tradinglens-e2e.invalid`.** `.invalid` is reserved by RFC 2606
  and can never resolve.
- **The demo account is never touched**, and it doesn't exist on the dev
  project anyway.

If a run is killed part-way, its user may survive on the dev project. That's
harmless: search its Auth page for `tradinglens-e2e.invalid` and delete them.

## Two things that will surprise you

**1. Sessions are established by magic link, not by the sign-in form.**
`fixtures/test-user.ts` mints a service-role magic link and feeds it through
the app's own `/auth/confirm` route, which is the same code path a real emailed
link takes. It's faster, and service-role calls bypass CAPTCHA, so the
autosave and OCR specs work whatever the project's CAPTCHA setting.

`auth.spec.ts` is the exception: it drives the real form on purpose.
**It skips itself if CAPTCHA is on** for the project it runs against, and
prints the reason on each skipped test. It detects that by asking Supabase:
a tokenless password grant answers `captcha_failed`. Nothing reads a
checked-in flag, so once CAPTCHA is off the tests come back by themselves.
The dev project should have CAPTCHA off, so these tests run.

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
- **Dismiss the first-visit overlays.** A fresh user is asked about a demo
  journal, then offered the tour, on `/trades`; both swallow clicks. Every
  helper clicks "No thanks, start empty" and then "I'll explore on my own",
  tolerating their absence.
- **Let the trade page settle before counting requests.** It issues its own
  PATCH shortly after mount, which will otherwise be attributed to whatever
  you were measuring.
