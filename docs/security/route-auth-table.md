# Route auth table (item 1.3)

From the security gaps pass ([02-gaps-report.md](02-gaps-report.md)), as of
2026-10-18. **Every route handler checks the caller itself**; none relies only
on the proxy. **There are no server actions** (`"use server"` appears nowhere
in `src`).

How the caller is known:
- `src/proxy.ts` deletes any client-sent `x-user-id` and sets it only after
  `supabase.auth.getUser()` has verified the session.
- **U:** `getUserIdFromHeader()` (`src/lib/supabase/auth.ts`); a missing id
  returns 401.
- **P:** `requirePaidUser()` (`src/lib/ai-keys/guard.ts`); U plus a paid plan
  (401, then 403).
- **A:** U plus `isAdmin()` (`src/lib/auth/roles.ts`, reads
  `user_settings.is_admin` through RLS, fails closed; 403).
- Data reads and writes go through the RLS client, so even a correct id can
  only reach the caller's own rows.
- The handful of service-role uses are scoped to the verified id (listed in
  the audit report, item 6.3).

| Route | Methods | Check |
|---|---|---|
| account/consent | POST | U |
| account/delete | DELETE | U |
| account/export | GET | U |
| account/transactions | GET, POST | U |
| account/transactions/[id] | DELETE | U |
| admin/analytics-exclusion | POST | A |
| admin/plan | POST | A |
| admin/reviews/[id] | PATCH | A |
| admin/waitlist | GET, DELETE | A |
| ai-keys | GET, POST | P |
| ai-keys/[id] | PATCH, DELETE | P |
| ai-keys/[id]/test | POST | P |
| ai-keys/consent | POST, DELETE | P |
| ai-reviews/[id] | DELETE | P |
| ai-reviews/[id]/reply | POST | P |
| ai-reviews/period | GET, POST | P |
| ai-reviews/trade | POST | P |
| analytics/heartbeat | POST | U |
| analytics/track | POST | U |
| analytics/public-view | POST | **public by design**: per-IP limit of 60/hour, fixed path list, service-role counter only |
| chat/conversations | GET, POST | P |
| chat/conversations/[id] | GET, PATCH, DELETE | P |
| chat/conversations/[id]/turn | POST | P |
| chat/proposals/[id]/apply | POST | P |
| chat/proposals/[id]/dismiss | POST | P |
| commission-rules | GET, POST | U |
| commission-rules/[id] | PATCH, DELETE | U |
| commission-rules/recalculate | POST | U |
| cron/auto-execute | POST | **bearer `CRON_SECRET`**: timing-safe compare, fails closed if unset; outside the proxy |
| csp-report | POST | **public by design**: per-IP limit of 120/min |
| demo | POST | U |
| excursions | POST | P |
| field-definitions | GET, POST | U |
| field-definitions/[id] | PATCH, DELETE | U |
| folders | GET, POST | U |
| folders/[id] | DELETE | U |
| goals | GET, POST | U |
| goals/[id] | PATCH, DELETE | U |
| health | GET | **public by design**: static "ok" |
| health/ready | GET | **public by design**: up or down only; global 120/min |
| market-data/bars | GET | U |
| market-data/candles | GET | U |
| market-data/fx | GET | U |
| monthly-costs | GET, POST | U |
| monthly-costs/[id] | PATCH, DELETE | U |
| ocr/ai | POST | P |
| ocr/parse | POST | U |
| reviews/mine | GET, PUT, DELETE | U |
| reviews/prompt | GET, PATCH | U |
| settings/core-fields | PATCH | U |
| settings/dashboard-layout | PUT | U |
| settings/preferences | PATCH | U |
| settings/timezone | PATCH | U |
| settings/tour | GET, PATCH | U |
| strategies | GET, POST | U |
| strategies/[id] | PATCH, DELETE | U |
| strategy-rules | GET, POST | U / P |
| strategy-rules/[id] | PATCH, DELETE | U |
| trades | POST | U |
| trades/[id] | GET, PATCH, DELETE | U |
| trades/[id]/duplicate | POST | U |
| trades/[id]/export | GET | U |
| trades/[id]/fee | PUT | U |
| trades/[id]/fill-confirmed | POST | U |
| trades/[id]/folders | PUT | U |
| trades/[id]/history | GET | U |
| trades/[id]/history/[historyId]/restore | POST | U |
| trades/[id]/images | POST | U |
| trades/[id]/images/[imageId] | DELETE | U |
| trades/[id]/panel | GET | U |
| trades/[id]/strategies | PUT | U |
| trades/[id]/suggestions | POST | U |
| trades/export | GET | U |
| trades/import | POST | U |
| trades/import-json | POST | U |
| trades/import/parse-xlsx | POST | U |
| waitlist | POST | **public by design**: honeypot, per-IP limit of 5/hour, a duplicate answers ok |
| auth/callback | GET | **public by design**: Google sign-in code exchange (PKCE); `next` limited to an allowlist |
| auth/confirm/verify | POST | **public by design**: same-origin check; the one-time token is the credential |

**Pages:** server pages read the same verified header through
`requireUserId()`. Since G-13 (2026-10-18), the proxy runs on every page path;
only the static files `public/` serves skip it (`src/proxy.ts` matcher, tested
in `src/proxy.test.ts`).
