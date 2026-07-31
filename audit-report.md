# Site Audit — Trading Journal ("Trading Lens")

**Date:** 2026-07-14 · **Scope:** diagnostic only, nothing fixed · **Raw tool output:** `audit-raw-logs.txt`

**How this audit was run.** Static analysis (`tsc --noEmit`, ESLint, `next build`) plus a full source-code inspection, plus a Playwright runtime pass against a local dev server (port 3001). **Runtime testing was limited to logged-out surfaces** (landing, auth pages, legal pages, auth-gating, API auth responses, responsive checks) because the only configured Supabase environment is **production** and no test account or staging project exists — per the brief, that limitation is itself recorded as a finding (BUG-1) rather than worked around by writing to production. Findings in authenticated flows are from code analysis; each one states how to reproduce once a test account exists.

**Severity scale:** Critical = breaks a core flow or loses data · High = noticeably degrades a core flow · Medium = cosmetic/edge-case · Low = nitpick/cleanup.

**Baseline health:** `tsc --noEmit` clean · ESLint 0 errors / 11 warnings · production build succeeds (32 routes) · no horizontal overflow at 375/768/1024px on any public page · all API routes correctly return 401/405 when unauthenticated · admin analytics is double-gated (page redirect **and** `is_admin` checks inside every SQL RPC) · RLS policies present on all user tables.

---

## Bugs

### BUG-1 · No test account / staging environment — **High** (process, blocks safe testing)
- **Where:** `.env.local` (only `NEXT_PUBLIC_SUPABASE_URL` + anon key, pointing at production); no seed script, no documented test login.
- **Impact:** Authenticated flows (add/edit/delete trade, import, images, version history, emotions, ask panel) cannot be runtime-tested — by this audit or any future one — without touching real production data. This limited the runtime half of this audit.
- **Repro:** Try to sign in locally: there is no account to use that isn't a real user.
- **Fix direction (future task):** a dedicated test account, or a second Supabase project + `.env.test`.

### BUG-2 · Version-history "Restore" appears to do nothing — **High**
- **Where:** `src/lib/trades/use-autosave-trade.ts:11` + `src/components/trade-card/trade-history-panel.tsx:31-37`.
- **What:** `useAutosaveTrade` seeds React state with `useState(initialTrade)` and never re-syncs when the server component re-renders with fresh data. `TradeHistoryPanel.handleRestore` updates the DB then calls `router.refresh()` — the page's server component re-fetches the trade and passes a new `initialTrade` prop, but the stale `useState` value wins, so **the trade card keeps displaying the pre-restore values**. The restore only becomes visible after a full browser reload. Worse, if the user then edits any field, autosave PATCHes the stale on-screen values back over the restored row.
- **Repro:** open a trade → edit a field → Version History → Restore an older version → the card doesn't change; press F5 and it does.
- **Severity rationale:** core flow (version history) silently mis-renders and can overwrite restored data — High, borderline Critical.

### BUG-3 · Restore/history/duplicate/delete fetches don't check `res.ok` — **Medium**
- **Where:** `trade-history-panel.tsx:25-27` (`loadHistory`), `:33` (`handleRestore`); `TradeCard.tsx:63` (`handleDelete`), `:68-70` (`handleDuplicate`); `keyboard-shortcuts.tsx:67-69` ("n" = new trade).
- **What:** none of these check the response status.
  - `loadHistory`: an error response is an object, not an array → `history.map` throws (React error surface); a network failure leaves the panel stuck on "Loading..." forever (no catch).
  - `handleRestore`: on failure it still clears state and refreshes — looks like success.
  - `handleDelete`: navigates to `/trades` even if the DELETE failed — the trade quietly reappears.
  - `handleDuplicate` / keyboard "n": on failure `trade.id` is `undefined` → navigates to `/trades/undefined` → 404 page.
- **Repro:** any of these actions with the network offline (DevTools offline mode).

### BUG-4 · Autosave edits are lost on quick navigation — **Medium**
- **Where:** `src/lib/trades/use-autosave-trade.ts:8,94-97` — 600 ms debounce; no flush on unmount, no `beforeunload`/`visibilitychange` handler.
- **What:** type in a field and click "← Back to Trades" (or close the tab) within ~600 ms → the pending edit is silently dropped. The "Saving…" badge mitigates but doesn't prevent it.
- **Repro:** edit ticker → immediately click Back → reopen the trade: the edit is gone.

### BUG-5 · Autosave failure retries forever with no backoff or offline signal — **Medium**
- **Where:** `use-autosave-trade.ts:73-91` — on failure the keys are requeued and `scheduleRef.current()` re-arms the 600 ms timer unconditionally.
- **What:** with the API persistently failing (offline, expired session), the client hammers `/api/trades/[id]` every ~600 ms indefinitely. Status shows "error" but the user gets no "your session expired — changes are NOT being saved" signal; an expired session turns every subsequent edit into an infinite 401 loop.
- **Repro:** open a trade, go offline in DevTools, type in a field, watch the Network tab.

### BUG-6 · `session_start` analytics event permanently swallowed after a logged-out visit — **Medium** (observed at runtime)
- **Where:** `src/components/analytics-tracker.tsx:26-28` + `src/lib/tracking/useAnalytics.ts:19-27`.
- **What:** a logged-out visitor hitting a protected URL (bookmark, shared link) briefly mounts the tracker with a non-public pathname; it sets `sessionStorage["tj-analytics-session-started"]="1"` **before** the `track("session_start")` request, which then 401s (observed live: two 401s to `/api/analytics/track`, one to `/api/settings/timezone`). After signing in, `session_start` never fires for that browser session → admin analytics under-counts sessions. Also produces console-error noise for any logged-out visitor with a stale bookmark.
- **Repro:** logged out, visit `/dashboard` directly → console shows the 401s → sign in → no `session_start` row.

### BUG-7 · Support email `support@tradinglens.app` likely dead — **Medium** (live-site, user-facing)
- **Where:** `src/app/contact/page.tsx:20-23`, `src/app/privacy/page.tsx:92-93`, `src/app/terms/page.tsx:40-41`.
- **What:** all three pages link `mailto:support@tradinglens.app`, but the site is hosted at `tradinglenz.netlify.app` and no `tradinglens.app` domain/mailbox is known to be set up. Every support/bug/privacy email from real users bounces. With Instagram acquisition ongoing this is the site's only contact channel.
- **Repro:** send an email to the address; verify domain ownership.

### BUG-8 · Import reports a row as an error but silently inserts it anyway — **Medium**
- **Where:** `src/app/api/trades/import/route.ts:30-45`.
- **What:** when `buildRowFromMapping` returns an error but the row still has a ticker, the row is pushed to `rowErrors` **and** to `toInsert`. The wizard's summary then tells the user "row N failed" while row N was actually (partially) imported — double-import risk when the user "fixes" and re-imports those rows.
- **Repro:** import a CSV with one malformed field on a row that still has a ticker; compare the error list to the trades table.

### BUG-9 · Imported trades get contradictory `status: "closed"` + `result: "open"` — **Low**
- **Where:** `src/app/api/trades/import/route.ts:40-41`.
- **What:** every imported row is hard-coded closed-with-open-result. Computed stats use `dollar_pl` so numbers stay correct, but the Trades list shows "closed / open" badges that read as contradictory, and result-based UI filtering is wrong for the whole import.

### BUG-10 · "Ask" post-loss-streak stat skips the streak-ending trade — **Low**
- **Where:** `src/lib/ask/queries.ts:406-418`.
- **What:** the headline says "avg P/L in the next 3 trades after a 2+ loss streak", but collection starts at `j = i + 1`, skipping the winning trade that ended the streak (the first trade *after* the streak). A streak still ongoing at the end of the history is never counted at all. The stat systematically excludes exactly the bounce-back trade it advertises.

### BUG-11 · No request-body validation on import endpoints — **Low**
- **Where:** `src/app/api/trades/import/route.ts:16-18` (`body.rows`/`body.mapping` cast unchecked; contrast with `/api/trades/[id]` which zod-validates everything).
- **What:** a malformed authenticated request throws → generic 500 instead of a 400. No cross-user risk (RLS + `user_id` from session), purely robustness/log noise.

---

## Performance

### PERF-1 · Every request pays 2× `supabase.auth.getUser()` network round-trips — **High** (known, by-design tradeoff — decide, don't silently change)
- **Where:** `src/proxy.ts:28` (runs on nearly every route, ~100-250 ms baseline observed previously, spikes past 1 s) + every page/route handler calls `getUser()` again via `createClient()` (`src/lib/supabase/server.ts` has no per-request caching).
- **What:** two sequential Auth-server round-trips per page view before any real work. This is Supabase's documented defense-in-depth pattern (they warn against `getSession()` here), so collapsing it is a security/latency tradeoff **for the owner to decide** — but it is the single largest fixed cost on every page and belongs at the top of any perf conversation. It also compounds on Netlify cold starts.

### PERF-2 · Dashboard fires ~14 Supabase queries per view — **Medium**
- **Where:** `src/app/dashboard/page.tsx:33-55` — `Promise.all` of 10 helpers, several of which are multi-query: `getStatusCounts` = 4 count queries, `getWinRate` = 2, plus 7 more single queries and settings.
- **What:** parallelized, so wall-time is bounded by the slowest — but 14 round-trips per view burns connection/PostgREST overhead and magnifies any latency jitter. `getStatusCounts` alone could be one `GROUP BY status` RPC; win-rate could ride the same query.

### PERF-3 · Several aggregate queries fetch every (closed) trade row unbounded — **Medium** (fine today, degrades with data growth)
- **Where:** `listDistinctTagsAndEmotions` (`src/lib/trades/queries.ts:224-249`, all rows' `custom_fields` on every `/trades` view), `getBestWorstSetup` (`dashboard/queries.ts:131-138`), `getEmotionBreakdown` (`emotions/queries.ts:75-79`), `getInsights` (`insights/queries.ts:82-86`), `getAllAnswers` (`ask/queries.ts:114-119`), `getAnalyticsSummary` (`analytics/queries.ts:79-84`).
- **What:** all fetch every closed trade (or every trade) and aggregate in JS. At the current per-user scale this is fine — measured `/trades` is ~180-195 ms after the earlier N+1 fixes — but each of these is O(total trades) in both DB transfer and server memory, and `/trades` runs one of them on **every** page view just to populate two filter dropdowns. Candidates for a materialized `distinct_tags` approach or SQL-side aggregation when users pass a few thousand trades. The trades list itself is properly paginated with matching indexes (migrations 0001/0005) — no problem there.

### PERF-4 · Trade images bypass Next.js image optimization — **Low**
- **Where:** `ImageUploader.tsx:203,310`, `screenshot-trade-button.tsx:356,364` (the 4 ESLint `no-img-element` warnings).
- **What:** raw `<img>` on signed Supabase URLs — no resizing/AVIF/lazy-loading, so a trade with several 5 MB screenshots ships several 5 MB originals for thumbnail-sized grid cells. `next/image` with a custom loader (or client-side downscale before upload) would cut most of that.

### PERF-5 · Dashboard "Today's P/L" uses UTC day boundaries despite a stored user timezone — **Low**
- **Where:** `src/lib/dashboard/queries.ts:4-24` (acknowledged in a code comment). A trade closed 7 PM EST lands on "tomorrow." The user's timezone is already captured (`user_settings.timezone`) and used by insights/ask — just not here.

---

## Console / Network Errors

- **Observed (logged-out runtime pass):** `401 /api/settings/timezone` ×1 and `401 /api/analytics/track` ×2 when a logged-out browser hits a protected URL — the client components fire before the auth redirect completes. Same root cause as BUG-6. No other console errors, warnings, or failed requests on any public page (`/`, `/sign-in`, `/sign-up`, `/privacy`, `/terms`, `/contact`).
- **Not tested:** authenticated pages' console/network behavior (blocked by BUG-1).

---

## Dead Code / Unused Dependencies

- **DEAD-1 · `tesseract.js` ships as a production dependency but is never used at runtime — Medium (deploy weight).** The fallback engine was deliberately disabled after it crashed Netlify functions (`src/lib/ocr/engines/index.ts:68-79` documents why); `src/lib/ocr/engines/tesseract.ts` is now imported by nothing, and the only live `tesseract.js` import is `scripts/ocr-test.mjs` (a dev script). Moving it to `devDependencies` (or removing it plus `engines/tesseract.ts`) shrinks `node_modules` shipped to Netlify. Keep the explanatory comment.
- **DEAD-2 · Unused-variable lint warnings — Low.** The 7 `@typescript-eslint/no-unused-vars` warnings (`queries.ts:93-95`, `history.ts:51`) are the intentional destructure-to-drop pattern; renaming to a spread-omit helper or an eslint disable-line would silence them. Cosmetic.
- **No orphan modules found** among `src/lib`/`src/components` beyond the above; all other dependencies (`exceljs`, `papaparse`, `date-fns`, `sharp`, `zod`, `recharts`, `framer-motion`, `next-themes`, `lucide-react`, `@gutenye/ocr-node`) have live imports.

---

## Accessibility (flag-only)

- **A11Y-1 · OCR "Detected from image" panel is hard-coded for dark mode — Medium.** `ImageUploader.tsx:249-267,286` uses `text-zinc-300`/`text-zinc-400`/`border-zinc-600` with no `dark:` variants — in the app's **default light theme** the detected-field labels/values are light grey on a near-white panel, borderline unreadable. (Also a visual bug, filed here because it's fundamentally a contrast failure.)
- **A11Y-2 · Upload drop zone and lightbox aren't keyboard-operable — Low.** `ImageUploader.tsx:224-233` is a click-only `<div>` (no `role="button"`, no `tabIndex`, no key handler); the lightbox (`:305-323`) can't be dismissed with Escape.
- **A11Y-3 · Icon-only buttons rely on `title` only — Low.** Theme toggle (`nav-bar.tsx:106-112`) and image-delete "✕" (`ImageUploader.tsx:211-218`) lack `aria-label`; `title` alone isn't announced consistently.
- **Positive:** form inputs on sign-in/sign-up/trade card are properly `<label>`-wrapped; every `<img>` has alt text; landing page has sensible landmark structure (checked via accessibility snapshot).

---

## Responsiveness

- **Tested at 375 / 768 / 1024 px (Playwright, all six public pages): zero horizontal overflow, no broken layouts.** Landing, auth, and legal pages are clean at all three breakpoints.
- **Not tested:** authenticated pages (BUG-1). From code: the nav bar (`nav-bar.tsx:74` `overflow-x-auto`) and trades table (`trades/page.tsx:403` `overflow-x-auto`) both handle narrow viewports defensively, and dashboard grids collapse via `sm:`/`lg:` prefixes — no obvious breakage in code, but verify once a test account exists.

---

## Noted, out of scope

- **AI chat paid tier:** does not exist in the codebase at all — no stub, no route, no component (the paid-tier pricing card was previously removed). State: not started.
- **Legal copy:** `/privacy` and `/terms` carry real-looking copy now, but they cite the dead support address (BUG-7).

---

## Top 5 to fix first

1. **BUG-2 — Restore silently no-ops and can overwrite restored data** (core flow broken + data-overwrite risk; small fix: key the card or sync state on `initialTrade` change).
2. **BUG-7 — dead support email on contact/privacy/terms** (every user support request from the Instagram funnel bounces; 5-minute fix once a real inbox exists).
3. **BUG-1 — create a test account / staging Supabase** (unblocks runtime verification of every other authenticated-flow finding, including verifying BUG-2).
4. **BUG-4 + BUG-5 — autosave loses quick edits and retry-loops without warning** (silent data loss in the single most-used flow; add unmount/`beforeunload` flush + capped backoff with a visible "not saved" state).
5. **BUG-3 — unchecked `res.ok` across delete/duplicate/history/new-trade** (turns backend hiccups into silent failures and `/trades/undefined` navigations; mechanical fix in five call sites).

(PERF-1 is intentionally not in the Top 5: it's the biggest latency lever but requires an explicit security-tradeoff decision by the owner, not a drive-by fix.)
