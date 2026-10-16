# Changelog

What changed for people using Trading Lens, newest first. Versions follow
`package.json`: a minor bump for a release with new features or behaviour, a
patch bump for fixes only. There is no public API, so nothing here is an API
version (see docs/production-readiness.md, item 50).

## 0.2.0 — unreleased

### Added
- **Continue with Google** on sign-in and sign-up. It appears only once Google is switched on in Supabase.
- **Edit conflicts are caught.** When the same field of a trade is changed in another tab, the page asks
  whether to keep your change or use the saved version, instead of silently overwriting it.
- **Health checks** at `/api/health` and `/api/health/ready`, for an uptime monitor.

### Fixed
- **Phone:** the guided tour no longer covers the button it asks you to tap; it docks clear of its target
  and shrinks to a strip over menus and forms. Pop-up forms fit small screens and keep Create trade in reach.
- **Sign-up:** confirmation links opened first by an email security scanner no longer read as "expired",
  and "Send again" can be pressed as often as needed (with a short wait between sends).
- **No duplicate trades** from a double click, a held-down `n`, a repeated import, or a retried request.
- **No blank trades** left behind when Quick trade or a screenshot import failed half way.
- **Market data outages** say "temporarily unavailable" with Try again, instead of blaming the symbol.
  Prices show the time Yahoo quoted them.
- AI review, period review and excursion buttons no longer stay disabled forever after a network error.
- Uploads over Netlify's real limit get a clear message (the limit is now 4 MB).

### Changed
- Closing the tab during an AI review or screenshot read stops the request to the provider, so it is not
  billed to your key for an answer nobody will see.
- Server logs are structured, carry a request id, and never contain keys, emails or journal content.

## 0.1.0

Everything before this changelog started: the journal, analytics, insights, strategies, imports,
screenshot reading, AI reviews and Ask, reports, goals, and the paid plan.
