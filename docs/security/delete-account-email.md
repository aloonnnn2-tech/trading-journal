# The account-deletion email (Supabase "Magic link" template)

Deleting an account takes a link emailed to the account's own address
(2026-10-20). The email is Supabase's **Magic link** template, which this
app uses for nothing else: it has no "sign in by email link" option. Set it
once on **each** project, dev and live.

**Supabase dashboard → Authentication → Emails → Templates → Magic link**

**Subject:**

```
Confirm deleting your Trading Lens account
```

**Message body** (switch the editor to its source/HTML view and replace
everything):

```html
<h2>Delete your Trading Lens account?</h2>
<p>Someone asked to delete the Trading Lens account for {{ .Email }}.</p>
<p>If that was you, open this link, then press <strong>Delete my account</strong> on the page it opens:</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink&next=/account/delete/confirm">Continue to delete my account</a></p>
<p>The link works for one hour. Nothing is deleted until you press the button on that page.</p>
<p>If you didn't ask for this, ignore this email. Your account stays as it is.</p>
```

Then **Save**.

## Check the Site URL

The link is built from **Authentication → URL Configuration → Site URL**:

- **Live:** `https://tradinglenz.netlify.app`
- **Dev:** wherever you test the dev project locally, usually
  `http://localhost:3003` (`npm run dev:devdb`)

## Why this is safe

- Opening the link alone deletes nothing. It lands on `/auth/confirm`, which
  waits for a button press, so a mail provider's link scanner can't trigger
  it. That page signs the person in and sends them to
  `/account/delete/confirm`, which waits for a second press.
- The delete only goes through for a session signed in **from an emailed
  link, after the request**, within the hour
  (`src/lib/account/deletion-proof.ts`). If someone else makes Supabase send
  this email (anyone can ask Supabase for a magic link to any address),
  nothing happens: there's no request from the account itself, so the page
  says so and deletes nothing.
- The request route emails only the signed-in account's own address,
  limited to 3 an hour.

## The sending limit

Supabase's built-in mailer sends only a few emails an hour **for the whole
project**, shared with sign-up confirmations and password resets. If people
report that the email never arrives, connect a free email service as custom
SMTP (Authentication → SMTP Settings; see `docs/security/email-records.md`).
