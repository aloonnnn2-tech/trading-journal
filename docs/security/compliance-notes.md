# Compliance notes (hardening brief, Part B)

Checked 2026-10-09. **This is not legal advice.** Figures the brief quotes
from videos (fine amounts, court cases) are unverified and deliberately not
repeated here. Anything marked **Lawyer** needs a professional's review
before it is relied on. Alon is in Israel, and users may be in the US or the
EU, so both US rules and GDPR are assumed to apply.

## The seven traps from the brief

| # | Trap | What Trading Lens does now | Status |
|---|---|---|---|
| 1 | Sign-up never asks age | Required checkbox: "I'm 18 or older and I agree to the Terms and Privacy Policy". Submit is blocked until ticked. Migration 0061 records `age_confirmed_at`, `terms_accepted_at` and `terms_version` using the database clock, and the user cannot edit them. The Terms state the 18+ minimum. | **Done.** Accounts created before 2026-10-09 confirm once through the consent prompt (decision 2 below). An account created by calling the auth API directly, bypassing the form, gets the same prompt on first use. |
| 2 | Fonts from Google's servers | `next/font` self-hosts at build time; the CSP `font-src` is `'self'`. Visitors' browsers contact only Cloudflare Turnstile (on the auth pages), Sentry and Supabase. | **Not an issue.** All three are named in the Privacy Policy. |
| 3 | Session replay | Sentry replay is 0 / 0, and there is no third-party analytics. The app's own tracker records button labels and page paths, never typed text. | **Not an issue.** Problem 1 of the brief reworks the tracker and re-states what it stores. |
| 4 | Marketing email with no unsubscribe or postal address | The app sends no email of its own; the waitlist stores addresses only. Auth emails are transactional (Supabase). | **No email exists yet.** Requirements for when one does are below. The waitlist form now says what the address is for. |
| 5 | Checkout without renewal terms | No billing exists; the paid plan is set by hand. | **Not built.** Requirements for when Stripe is added are below. |
| 6 | User uploads without a DMCA agent | Screenshots are private (bucket not public, owner-only policies, signed URLs). Nothing is shared or public. | **Low risk today.** Register a DMCA agent if shared or public content is ever added. |
| 7 | "Per" multiplies small mistakes | n/a | Fixed at the root wherever possible (schemas, gates, tests), rather than one case at a time. |

## Also checked

- **Privacy Policy and Terms:** both exist and are linked from the footer and
  sign-up. The Privacy Policy now names every service that receives data:
  Supabase, Netlify, Cloudflare Turnstile, Sentry, Yahoo Finance (server-side,
  ticker and dates only), and the user's own AI provider. It also fixes the
  "on-device OCR" contradiction (OCR runs on our servers).
- **Export and delete:** in-app delete already existed. New: "Download all
  my data" on the Account page (`/api/account/export`), one JSON file with
  every table that holds the user's data, usage events included. A test
  fails if a new table is neither exported nor deliberately excluded.
- **"Not financial advice":**
  - Already on the Terms and on every AI review card.
  - Now also in the footer of every public page: "A trading journal and
    education tool. Not financial advice."
  - **Lawyer:** the wording, and whether it should also appear inside the
    app (stats pages).

## Requirements for later (do not build until the feature exists)

**Paid checkout (e.g. California auto-renewal law, unverified):**

- Price, renewal period and how to cancel, shown right next to the
  Subscribe button.
- Affirmative consent to the renewal terms captured, with a stored record.
- A confirmation email repeating the terms and how to cancel.
- Online cancellation that is as easy as signing up.
- **Lawyer:** which jurisdictions' rules to follow.

**Marketing email (waitlist launch email, newsletters):**

- A one-click unsubscribe link in every message, working within days.
- A physical postal address in the footer.
- Honest subject lines and sender.
- A suppression list that unsubscribes are written to and that every send
  checks.
- Send only to people who joined the waitlist; no purchased lists.
- **Lawyer / Alon:** which postal address to publish.

**Public or shared content (if it is ever added):**

- Register a DMCA agent with the US Copyright Office.
- Add a takedown page and process.

## Decisions (Alon, 2026-10-09)

1. **Target users: worldwide.** Assume the strictest rules that apply, GDPR
   included, everywhere.
2. **Existing users re-confirm: yes.** Signed-in accounts with no recorded
   agreement get a one-time prompt (`src/components/legal/consent-gate.tsx`):
   - It asks them to confirm 18+ and accept the Terms and Privacy Policy, or
     sign out.
   - It isn't shown on /terms, /privacy, /cookies or /contact, so those can
     be read first.
   - It records through `POST /api/account/consent` (server clock, current
     terms version only).
   - If 0061 is ever missing it shows nothing, so nobody is locked out.
3. **Wording of the disclaimer and the age clause:** Alon reviews it on the
   running app. A lawyer's review is still recommended.
