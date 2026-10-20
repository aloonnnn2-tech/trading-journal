# The account-deletion email

Deleting an account takes a link emailed to the account's own address
(2026-10-20). The link ends in a **one-time code** that only that email
contains: `/account/delete/confirm/<code>`. The page there deletes nothing
until its button is pressed, and only for the account signed in, with the
code from the newest email, within an hour (`src/lib/account/deletion-proof.ts`).

The email is Supabase's **Magic link** email. This app uses it for nothing
else: it has no "sign in by email link" option.

## What's needed: one Redirect URL per project

Without your own email service (custom SMTP), Supabase sends its default
email: **"Your sign-in link"**, with a **Sign in** link. That works as it
is; the Account page tells people to expect that title. The link returns to
the code address, so Supabase must allow it:

**Supabase → Authentication → URL Configuration → Redirect URLs → Add URL**

- **Live** (project `uskk…`): `https://tradinglenz.netlify.app/account/delete/confirm/*`
- **Dev** (project `tjvu…`): `http://localhost:3003/account/delete/confirm/*`

The `*` at the end matters: it stands for the code, which is different in
every email. If you added the earlier address without `/*`, you can remove
it.

The link works in **any** browser or device. Opened while signed out, the
page asks you to sign in and then comes straight back.

## Later, with an email service: a proper template

Supabase only lets you edit email templates once custom SMTP is connected
(a free tier such as Brevo, see `docs/security/email-records.md`). Then set
the Magic link template on each project:

**Subject:** `Confirm deleting your Trading Lens account`

**Body (Source view):**

```html
<h2>Delete your Trading Lens account?</h2>
<p>Someone asked to delete the Trading Lens account for {{ .Email }}.</p>
<p>If that was you, open this link, then press <strong>Delete my account</strong> on the page it opens:</p>
<p><a href="{{ .RedirectTo }}">Continue to delete my account</a></p>
<p>The link works for one hour. Nothing is deleted until you press the button on that page.</p>
<p>If you didn't ask for this, ignore this email. Your account stays as it is.</p>
```

`{{ .RedirectTo }}` is the code address itself, so this needs no other
change.

## Why this is safe

- **Only the email has the code.** It goes from our server to Supabase's
  mailer, and is never sent to the browser that asked. A stolen session or a
  script in the page can ask for deletion, but can't finish it.
- **The code is checked against the signed-in account**, by the account's id
  and never by anything in the address. Only a hash of the code is stored.
  Asking again replaces it, so older emails' links stop working.
- **Opening the link deletes nothing**, so a mail provider's link scanner
  opening it first is harmless. If Supabase's own part of the link was
  already used, Supabase still sends the person to the code address, so it
  still works.
- **One hour**, and **3 requests an hour** per account.

## The sending limit

Supabase's built-in mailer sends only a few emails an hour **for the whole
project**, shared with sign-up confirmations and password resets. Connecting
an email service removes that limit too.
