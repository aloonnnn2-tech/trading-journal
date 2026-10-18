# Account security checklist (2FA and access)

From the security gaps pass, item 1.1 ([02-gaps-report.md](02-gaps-report.md)).
These are the accounts that can reach Trading Lens's production data or code.
Only you can switch these settings on; the code can't. Tick each box as you
do it, and write the date beside it.

For every account the same three rules apply:

- **Two-factor authentication on**, with an authenticator app or a passkey,
  not SMS where avoidable.
- **Recovery codes saved offline**: printed, or in your password manager,
  never only on the same phone as the authenticator.
- **No shared logins.** If anyone else ever helps, they get their own seat with
  the least access that works, and it's removed when they stop.

## Supabase (live project, and the separate dev project)

Holds every user's data, the auth settings and the screenshots.

- [ ] Account → Security → enable two-factor authentication.
- [ ] Recovery codes stored offline.
- [ ] Organization → Team: only you are a member (or list who else and why).
- [ ] If the organization offers "Require MFA for all members", turn it on.

## Netlify

Holds every production secret (service-role key, encryption secret, cron
secret) and deploys the site.

- [ ] User settings → Security → two-factor authentication on.
- [ ] Recovery codes stored offline.
- [ ] Team members: only you.
- [ ] See also [netlify-checklist.md](netlify-checklist.md) (deploy previews),
      written in Phase 4.

## GitHub

The code (a push to `main` deploys), plus the backup workflow's secrets (the
service-role key and the backup passphrase).

- [ ] Settings → Password and authentication → two-factor authentication on.
- [ ] Recovery codes stored offline.
- [ ] Repository → Settings → Collaborators: only you.
- [ ] Settings → SSH and GPG keys / Personal access tokens: remove any you
      don't recognise or no longer use.

## Sentry

Error reports, which can contain request details.

- [ ] Account → Security → two-factor authentication on.
- [ ] Recovery codes stored offline.
- [ ] Organization members: only you.
- [ ] Auth tokens (used for source-map upload): remove any unused.

## Cloudflare (Turnstile, the sign-in security check)

Someone in this account could switch the CAPTCHA off.

- [ ] My Profile → Authentication → two-factor authentication on.
- [ ] Recovery codes stored offline.

## Google Cloud (the "Continue with Google" sign-in)

Holds the OAuth client that signs users in.

- [ ] Your Google account → Security → 2-Step Verification on.
- [ ] Backup codes stored offline.
- [ ] Cloud project → IAM: only you.

## Email accounts

- [ ] The Google account used as the app's admin login: 2-Step Verification on.
- [ ] The support mailbox (`TradingLenzSupport@proton.me`): two-factor
      authentication on, recovery saved offline.
- [ ] The email address that recovers each account above: it is the master
      key to all of them, so 2FA on it first.

## Password manager

Holds the backup passphrase and these accounts' passwords.

- [ ] Master password unique and long; 2FA on the password manager account.
- [ ] Emergency access or recovery kit stored offline.

## AI and OCR providers

Not applicable to the app itself: every user brings their own key, and the
app holds no provider account of its own. If you keep personal provider keys
(for example for testing Ask), turn 2FA on in those accounts too.

- [ ] Any provider account you use personally: 2FA on.
