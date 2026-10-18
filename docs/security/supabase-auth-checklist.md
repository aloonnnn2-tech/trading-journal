# Supabase Auth settings checklist

From the security gaps pass, item 1.4 ([02-gaps-report.md](02-gaps-report.md)).
The code can't see the Supabase dashboard, so **none of the current values
below are guessed**. For each line, look at the live project, write down what
it says, and change it if it differs from the recommendation. Rate limits,
the password minimum and JWT expiry are already covered step by step in
[../../SECURITY-RUNBOOK.md](../../SECURITY-RUNBOOK.md) §1, §2 and §4; they're
listed here so the whole picture is on one page.

Do this on the **live** project. The dev project deliberately differs:
confirmation off, CAPTCHA off (see `docs/dev-accounts.md`).

| Setting | Where in the dashboard | Recommended | What it says now | Done |
|---|---|---|---|---|
| Email confirmation required | Authentication → Sign In / Providers → Email → "Confirm email" | **On.** You confirmed it is on (2026-10-18). | on | [x] |
| Minimum password length | same panel → Password requirements | 8 (matches the forms) | | [ ] |
| Password character requirements | same panel | optional; length matters more | | [ ] |
| Leaked-password protection | same panel | On if available (Pro plan only) | | [ ] |
| Email OTP / magic-link expiry | Authentication → Sign In / Providers → Email → "Email OTP expiration" | 3600 seconds or less (the confirm page takes a click, so an hour is plenty) | | [ ] |
| Access token (JWT) expiry | Authentication → Sessions (or Project Settings → JWT) | 1800 seconds (SECURITY-RUNBOOK §4) | | [ ] |
| Refresh token reuse detection | Authentication → Sessions | On | | [ ] |
| Session time-box / inactivity timeout | Authentication → Sessions | Set if your plan offers it (e.g. 30-day time-box) | | [ ] |
| Site URL | Authentication → URL Configuration → Site URL | `https://tradinglenz.netlify.app` | | [ ] |
| Redirect URL allowlist | Authentication → URL Configuration → Redirect URLs | **Exact URLs only, no wildcards:** `https://tradinglenz.netlify.app/auth/confirm`, `https://tradinglenz.netlify.app/auth/callback`, plus `http://localhost:3000/auth/confirm` and `/auth/callback` only if you sign in locally against live. Remove `**` patterns and old Netlify preview URLs. | | [ ] |
| CAPTCHA (Turnstile) | Authentication → Attack Protection → CAPTCHA | On, Turnstile, with the secret key set | | [ ] |
| Rate limits | Authentication → Rate Limits | as in SECURITY-RUNBOOK §1 (sign-in 5 per 5 min, sign-ups 10/hour, emails 10/hour) | | [ ] |
| Allow new sign-ups | Authentication → Sign In / Providers → "Allow new users to sign up" | On (you want sign-ups). Turn it off only to stop a sign-up flood. | | [ ] |
| Anonymous sign-ins | same panel | **Off** (the app doesn't use them) | | [ ] |
| Providers | Authentication → Sign In / Providers | Only Email and Google enabled; everything else off | | [ ] |
| Custom SMTP | Authentication → Emails → SMTP Settings | Optional now; recommended before a sign-up surge (the built-in mailer has a low hourly cap) | | [ ] |
| Email templates | Authentication → Emails → Templates | Confirm and reset links point to `/auth/confirm` (the page with the button), as in `docs/google-sign-in-setup.md` and the sign-up fix | | [ ] |

When it's done, tell Claude what changed. The audit report's 1.4 row then
moves from "checklist" to "verified on <date>".
