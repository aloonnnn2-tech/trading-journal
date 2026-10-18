# Email: what sends it, and the records it would need

From the security gaps pass, item 6.1 ([02-gaps-report.md](02-gaps-report.md)).
Checked 2026-10-18.

## Today: nothing to set up

- **The app sends no email itself.** There's no mail library and no SMTP
  setting in the code. The only emails are Supabase Auth's: sign-up
  confirmation and password reset (plus the email-change ones, if used).
- They go through **Supabase's built-in mailer**, from Supabase's own
  domain. Its SPF, DKIM and DMARC are Supabase's to run.
- **No custom domain:** the site is `tradinglenz.netlify.app`. A
  `netlify.app` address has no DNS of our own to put records in, so there
  is nothing to add.
- **Support address:** `TradingLenzSupport@proton.me` (contact, privacy
  and cookies pages), described as live. The address reported dead earlier,
  `support@tradinglens.app`, is gone from the code. **Still worth doing: send
  it one test email from an outside address and check it arrives** (nobody
  has confirmed that in writing).

## The trade-off of staying like this

- **Delivery is the weak point.** Supabase's built-in mailer is meant for
  development. It has a low hourly sending cap, and its mail comes from an
  address people don't recognise, so it's likelier to land in spam. With
  email confirmation on, an email that doesn't arrive is a sign-up that
  never finishes, or a password reset that never comes. **Nobody has
  checked that resets reach real inboxes (Gmail, Outlook) on live.** Try it
  once with a spare address.
- **Phishing.** Without a domain of our own, there's no way to tell users
  "real mail only ever comes from @our-domain". Anyone can make a free
  "Trading Lens support" mailbox somewhere.
- The upside: no DNS to look after, and nothing of ours to spoof.

## When a custom domain or custom SMTP arrives (Q6)

Do all of this before switching Supabase Auth to send from the new domain.
A free SMTP tier (for example Resend or Brevo) is enough at this size; both
give you the exact record values.

- [ ] **SPF:** one TXT record on the sending domain naming the provider
      (e.g. `v=spf1 include:<provider> ~all`). Only one SPF record per
      domain: merge, never add a second.
- [ ] **DKIM:** the CNAME or TXT records the provider gives. Then check its
      dashboard shows "verified".
- [ ] **DMARC:** TXT at `_dmarc.<domain>`. Start with
      `v=DMARC1; p=none; rua=mailto:<your address>`. Read the reports for a
      couple of weeks, then move to `p=quarantine`.
- [ ] **Supabase → Authentication → SMTP settings:** the provider's host,
      port, user and password, and a sender like `no-reply@<domain>`.
- [ ] **Supabase → Authentication → Email templates:** check the links
      still point at the live site.
- [ ] Send yourself a confirmation and a reset. In Gmail, "Show original"
      should say SPF, DKIM and DMARC all **PASS**.
- [ ] Move the support address to the domain too, and update the contact,
      privacy and cookies pages.
- [ ] Cookie scope and the Supabase redirect URL list change with the
      domain: see `docs/security/supabase-auth-checklist.md`.
