# The account-deletion email

Deleting an account takes a link emailed to the account's own address
(2026-10-20). The email is Supabase's **Magic link** email. This app uses it
for nothing else: it has no "sign in by email link" option.

## What's needed today (no email service): one setting per project

Supabase only lets you edit email templates once you connect your own email
service (custom SMTP). Without one, the email is Supabase's default:
**"Your sign-in link"**, with a **Sign in** link. That works as it is. The
Account page tells people to expect that title.

The default link returns to `/account/delete/confirm`, so that address must be
on the project's list of allowed return addresses:

**Supabase → Authentication → URL Configuration → Redirect URLs → Add URL**

- **Live** (project `uskk…`): `https://tradinglenz.netlify.app/account/delete/confirm`
- **Dev** (project `tjvu…`): `http://localhost:3003/account/delete/confirm`

Without it, Supabase sends the link to the Site URL instead, and the deletion
can't finish.

**One limit of the default email:** its link only works in the **same
browser** where the deletion was asked for. Supabase's default flow ties the
link to a secret stored in that browser. The page says so if it's opened
elsewhere. That's also a safety feature: someone else can't use the link.

## Later, with an email service: a proper template

With custom SMTP connected (a free tier such as Brevo, see
`docs/security/email-records.md`), set the Magic link template on each
project:

**Subject:** `Confirm deleting your Trading Lens account`

**Body (Source view):**

```html
<h2>Delete your Trading Lens account?</h2>
<p>Someone asked to delete the Trading Lens account for {{ .Email }}.</p>
<p>If that was you, open this link, then press <strong>Delete my account</strong> on the page it opens:</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink&next=/account/delete/confirm">Continue to delete my account</a></p>
<p>The link works for one hour. Nothing is deleted until you press the button on that page.</p>
<p>If you didn't ask for this, ignore this email. Your account stays as it is.</p>
```

That link works in any browser, and survives mail scanners that open links
(it waits for a button press on `/auth/confirm`). The app handles both kinds
of link, so switching needs no code change.

## Why this is safe

- The delete only goes through for a session signed in **from an emailed
  link, after the request**, within the hour
  (`src/lib/account/deletion-proof.ts`). A stolen session or a script in the
  page can ask, but can't finish.
- Anyone can make Supabase send a sign-in link to any address. On its own
  that does nothing: there's no deletion request from the account, so the
  page deletes nothing.
- The request route emails only the signed-in account's own address,
  limited to 3 an hour.
- Nothing is deleted until the button on `/account/delete/confirm` is
  pressed.

## The sending limit

Supabase's built-in mailer sends only a few emails an hour **for the whole
project**, shared with sign-up confirmations and password resets. Connecting
an email service removes that limit too.
