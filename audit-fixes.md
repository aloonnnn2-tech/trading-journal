# Audit fix pass — 2026-07-28

Follow-up to `audit-report.md` (2026-07-14). Fixing BUG-2 through BUG-8 (BUG-1 is
effectively resolved — a confirmed demo login with ~50 seeded trades now exists.
Credentials are deliberately not recorded here: this repo is public. They're in the
`trading-journal-strategies-feature` project memory, outside the repo).
BUG-9/10/11 (Low severity) and the Performance section are intentionally out of
scope for this pass.

Status key: 🔲 not started · 🔧 in progress · ✅ fixed · ⏸️ blocked

---

## BUG-2 · Version-history "Restore" appears to do nothing — ✅ fixed, verified live

**Root cause:** `useAutosaveTrade` seeds `useState(initialTrade)` once on mount and
never re-syncs when the server component re-renders with fresh data after
`router.refresh()`.

**Fix:** sync local state to the incoming `initialTrade` when it changes
(detected via `updated_at`, which a DB trigger bumps on every trade update,
including restore) — but only when there's no unsaved local edit in flight, so
this never clobbers active typing.

**Files:** `src/lib/trades/use-autosave-trade.ts`

**Verified live** (2026-07-28, dev server + demo account, Playwright): edited a
trade's ticker, confirmed "Saved", restored the prior version from Version
History, and the ticker field (and price chart) updated immediately in the UI
with no manual reload — matches the exact repro steps in the original report.

---

## BUG-3 · Restore/history/duplicate/delete fetches don't check `res.ok` — ✅ fixed

**Root cause:** five call sites assume every fetch succeeds and act on the
result unconditionally.

**Fix:** check `res.ok` at each site; surface a visible error instead of
silently proceeding (no toast infra in this codebase, so errors use inline
text / `alert()` consistent with the existing `confirm()` usage nearby).

**Files:** `src/components/trade-card/trade-history-panel.tsx` (loadHistory,
handleRestore), `src/components/trade-card/TradeCard.tsx` (handleDelete,
handleDuplicate), `src/components/keyboard-shortcuts.tsx` ("n" shortcut)

---

## BUG-4 · Autosave edits are lost on quick navigation — ✅ fixed

**Root cause:** 600ms debounce with no flush on unmount, `beforeunload`, or
`pagehide`.

**Fix:** flush any pending edit via `fetch(..., { keepalive: true })` on
component unmount (covers client-side nav, e.g. "← Back to Trades") and on
`pagehide`/`beforeunload` (covers closing the tab / hard navigation).

**Files:** `src/lib/trades/use-autosave-trade.ts`

---

## BUG-5 · Autosave failure retries forever with no backoff or offline signal — ✅ fixed

**Root cause:** on failure, the same 600ms timer re-arms unconditionally
forever, and `status` flips back to "saving" on every retry, so a persistent
failure (offline, expired session) hammers the API every 600ms while the
on-screen "Save failed" indicator flickers instead of holding steady.

**Fix:** exponential backoff on automatic retries (capped at 30s), and keep
the status pinned on "error" during background retries instead of flashing
back to "saving" each attempt.

**Files:** `src/lib/trades/use-autosave-trade.ts`

---

## BUG-6 · `session_start` analytics event permanently swallowed after a logged-out visit — ✅ fixed

**Root cause:** the `sessionStorage` "already started" flag is set *before*
the tracking request resolves, so a 401 (logged-out visitor briefly hitting a
protected URL) still marks the session as started — permanently, for that
browser tab.

**Fix:** only set the flag after a confirmed-successful response.

**Files:** `src/lib/tracking/useAnalytics.ts`, `src/components/analytics-tracker.tsx`

---

## BUG-7 · Support email `support@tradinglens.app` likely dead — ⏸️ deferred by user (2026-07-28)

**Root cause:** three pages link a mailbox on a domain nobody owns
(`tradinglens.app`); the real site is `tradinglenz.netlify.app`.

**Fix:** swap in a real, working support address. **Needs an address from the
user — not guessed.** Asked on 2026-07-28; user chose to leave it as-is for
now rather than use their personal Gmail as a stand-in. Revisit once a real
support inbox/domain exists.

**Files:** `src/app/contact/page.tsx`, `src/app/privacy/page.tsx`, `src/app/terms/page.tsx`

---

## BUG-8 · Import reports a row as an error but silently inserts it anyway — ✅ fixed

**Root cause:** `withDerivedFields`/insert logic is actually working as
documented (partial rows with a valid ticker are intentionally inserted with
whatever parsed cleanly, per the code comment in `import.ts`) — but the error
message doesn't say that, so a user reading "Row N: <error>" reasonably
assumes the row wasn't imported and re-imports the whole file after fixing
it, creating a duplicate.

**Fix:** disambiguate the message: rows skipped entirely (no ticker) say
"skipped", rows inserted with a field issue say "imported with issues" —
without changing the underlying partial-import behavior, which is intentional.

**Files:** `src/app/api/trades/import/route.ts`

---

## Verification (2026-07-28)

- [x] `tsc --noEmit` clean
- [x] `eslint` — same 11 pre-existing warnings as the 2026-07-14 baseline, 0 errors, no new warnings
- [x] `next build` succeeds (all 51 routes)
- [x] BUG-2 additionally verified live against the demo account (see above)

**Not deployed.** Netlify deploys are on hold until the user is able to push
again (~end of August 2026) — see `trading-journal-deployment` memory. These
fixes are committed locally / staged but not pushed to `main`.

## Summary

6 of 7 targeted bugs fixed (BUG-2 through BUG-6, BUG-8). BUG-7 deferred at the
user's request pending a real support email. BUG-1 was already resolved
separately (demo account exists). BUG-9/10/11 (Low) and the Performance
section remain untouched, as scoped.

---
---

# Pass 2 — full re-scan, 2026-07-28

A fresh read of all ~15k lines of `src/` (not just the 2026-07-14 findings),
looking for bugs and latency. Closed out the leftover Low-severity items from
the original audit, most of the Performance section, and **7 issues the first
audit never found**. Same constraint as before: **nothing deployed.**

## New findings (not in `audit-report.md`)

### NEW-1 · Uploaded filename flows into the storage object key — ✅ fixed · **High**
- **Where:** `src/app/api/trades/[id]/images/route.ts`
- **What:** the object key was built as `` `${userId}/${tradeId}/${uuid}.${ext}` `` where
  `ext = file.name.split(".").pop()`. `file.name` is entirely client-controlled and
  is never a single path segment by guarantee — a name like `chart.png/../../elsewhere`
  yields an "extension" containing `/` and `..`, which lands directly in the storage
  key. The random UUID prevents *guessing* another object, but nothing here
  constrained the key to the intended per-user prefix.
- **Fix:** derive the extension from the already-validated MIME type via an
  `EXT_BY_MIME` lookup, so the key can only ever contain `jpg|png|webp|gif`. Also
  wrapped `request.formData()` in try/catch (a truncated multipart upload 500'd).

### NEW-2 · Dashboard and Analytics reported different win rates — ✅ fixed, proven live · **Medium**
- **Where:** `getWinRate` in `src/lib/dashboard/queries.ts`
- **What:** the dashboard counted every `status = "closed"` trade, while
  `/analytics`, `/insights` and `/ask` all additionally require
  `exit_date is not null`. Any closed trade without an exit date therefore sat in
  the dashboard's denominator and nobody else's, so the two pages showed different
  win rates for the same history — the exact class of inconsistency a previous fix
  had already addressed for the `result`-vs-`dollar_pl` definition.
- **Fix:** added the same `.not("exit_date", "is", null)` filter to both legs.
- **Proven, not assumed:** the demo account happened to have 0 such trades, so the
  bug was invisible there. Inserted one closed, profitable, exit-date-less trade
  and measured: old logic **18/37 = 49%**, new logic **17/36 = 47%** — the
  divergence reproduced exactly. Temp trade deleted afterwards.

### NEW-3 · Whole chart torn down and rebuilt on every Stop Loss/Entry/TP keystroke — ✅ fixed, verified live · **Medium (latency)**
- **Where:** `src/components/trade-card/PriceChart.tsx`
- **What:** one `useEffect` both built the chart and drew the price lines, with
  `entryPrice`/`stopLoss`/`takeProfit` in its dependency array. Those come straight
  off the trade form, so **every keystroke** in those fields ran `chart.remove()` +
  `createChart()` + `setData(~130 candles)`. The ticker had been deliberately
  debounced for exactly this reason; the price lines were missed.
- **Fix:** split into two effects — chart/series creation (keyed on candles + theme)
  and price lines (keyed on the three prices), adding/removing just the lines on the
  retained series, with a guard so a disposed series is never touched.
- **Verified live:** tagged the chart `<canvas>`, typed 5 characters into Stop Loss,
  and confirmed the *same* canvas element was still mounted afterwards
  (`chartSurvivedRebuilds: true`) with zero console errors — previously each
  keystroke replaced it.

### NEW-4 · `/trades` shipped every trade's entire notes corpus on every page view — ✅ fixed, measured · **Medium (latency)**
- **Where:** `listDistinctEmotions` in `src/lib/trades/queries.ts`
- **What:** `select("custom_fields")` over every trade, unbounded, on every `/trades`
  view — purely to populate one filter dropdown. `custom_fields` is where all the
  user's free-text trade notes live, so this pulled the user's whole notes history
  over the wire and into server memory on each page load.
- **Fix:** project just the three emotion keys server-side with PostgREST's `->`
  operator (`custom_fields->emotion_before` etc.).
- **Measured:** verified against the live DB that both queries return an identical
  emotion set, with the payload dropping **18,793 → 4,197 bytes (−78%)** on only 51
  lightly-noted trades; the gap widens with every note the user writes. Confirmed in
  the app that the dropdown still lists the same 7 emotions.

### NEW-5 · `getAccountBalance` fetched 5 columns × every trade, on the trade-creation hot path — ✅ fixed · **Medium (latency)**
- **Where:** `src/lib/account/queries.ts`
- **What:** one `select("status, dollar_pl, entry_price, shares, position_size")` over
  *all* trades. It runs on every dashboard view **and inside `POST /api/trades`**
  (position-size prefill), so creating a trade scaled with total trade count. The
  committed-cash half only ever needs open trades — typically a handful — but was
  reading every closed trade too.
- **Fix:** split into two narrow queries: `dollar_pl` where non-null, and the three
  cost columns filtered to `status = "open"`.

### NEW-6 · `ImageUploader` called the parent's setState from inside a state updater — ✅ fixed · **Low**
- **Where:** `src/components/trade-card/ImageUploader.tsx`
- **What:** `setImagesState(prev => { onCountChange?.(next.length); ... })` — a
  `useState` updater must be pure. React may invoke it more than once per commit
  (and does in StrictMode), so this both double-fired the parent's image-count chip
  and performed an update-during-render of a different component.
- **Fix:** moved the notification into a `useEffect` keyed on `images.length`.
  (ESLint's `react-hooks/refs` rule then correctly rejected my first attempt at
  syncing the callback ref during render — corrected to do that in an effect too.)

### NEW-7 · PriceChart saved the symbol override under a key it never reads back — ✅ fixed · **Low**
- **Where:** `src/components/trade-card/PriceChart.tsx`
- **What:** `applyOverride` wrote to `overrideKey(ticker)` (the live prop) while the
  effect that restores it reads `overrideKey(debouncedTicker)`. Correcting a symbol
  within 600ms of editing the ticker saved the override under a half-typed ticker,
  so it was silently never found again.

## Leftover items from the original audit, now closed

- **BUG-9 · imported trades got contradictory `status: "closed"` + `result: "open"` — ✅ fixed.**
  New shared `deriveStatusAndResult()` in `src/lib/trades/import.ts` infers status from
  whether the row shows any evidence of completion (exit price / exit date / computed
  P&L) and result from the sign of `dollar_pl`, while letting an explicitly mapped
  status/result column win. Wired into both `/api/trades/import` and
  `/api/trades/import-json` (the JSON route had the same hard-coding).
- **BUG-10 · post-loss-streak stat excluded the streak-ending trade — ✅ fixed.**
  The window started at `i + 1`, dropping the trade at `i` — which, since a streak can
  only end on a win, meant a winner was systematically excluded from every sample,
  biasing the advertised "avg P/L in the next 3 trades" downward. Now starts at `i`.
- **BUG-11 · unvalidated `request.json()` → 500 on a malformed body — ✅ fixed** on both
  import routes (plus a mapping-shape check). Verified the other `request.json()`
  call sites and the remaining ones are zod-validated already.
- **PERF-5 · UTC day boundaries despite a stored user timezone — ✅ fixed.**
  New `src/lib/dates/local-day.ts` computes true timezone-aware day boundaries
  (two-pass offset resolution, so DST transitions land correctly). "Today's P/L" and
  the monthly calendar now bucket by the user's own calendar day; previously a trade
  closed 7pm EST counted as *tomorrow*. Also added the missing `status = "closed"`
  filter to `getTodayPL`. The dashboard now loads settings in a first wave so the
  timezone is known, keeping everything else parallel rather than serializing behind it.
- **A11Y-1 · OCR "Detected from image" panel unreadable in light mode — ✅ fixed.**
  It used `text-zinc-300`/`text-zinc-400`/`border-zinc-600` with no light variants, i.e.
  near-white text on a near-white panel in the app's **default** theme. Added proper
  light-mode colors with `dark:` variants.
- **DEAD-1 · `tesseract.js` shipped as a production dependency — ✅ fixed.** Moved to
  `devDependencies` (only a dev script imports it; the fallback engine is
  intentionally disabled). Shrinks what gets bundled to Netlify.
- **NEW-8 · duplicate route 500'd instead of 404'ing** for an unknown id — ✅ fixed.

## Deliberately NOT changed

- **PERF-1 (double `getUser()` per request)** — unchanged, again. It is still the single
  biggest fixed latency cost, but collapsing it means trusting the middleware's check
  instead of Supabase's documented defense-in-depth pattern. That's a security tradeoff
  for the owner to make explicitly, not a drive-by optimization.
- **PERF-2 (dashboard fires ~14 queries)** — the individual queries are now much
  narrower (NEW-5), and collapsing the count-queries into a `GROUP BY` RPC needs a new
  migration, which in this project has to be pasted into the Supabase SQL editor by
  hand. Left for a session where a migration is being applied anyway.
- **PERF-3 (remaining unbounded aggregate fetches)** and **PERF-4 (`<img>` not
  optimized)** — untouched; the two worst offenders in PERF-3 are fixed above.

## Verification (pass 2)

- [x] `tsc --noEmit` clean
- [x] `eslint src` — 0 errors, same 11 pre-existing warnings as the 2026-07-14 baseline
- [x] `next build` succeeds (41 static pages generated, compiled in 7s)
- [x] Live smoke test against the demo account: `/dashboard` (47% win rate, 36 closed,
      correct July 2026 local calendar), `/analytics` (matching 47%), `/trades`
      (emotion dropdown unchanged, 50 rows), `/ask` (streak panel renders), trade
      detail (chart + autosave, "Saved", no console errors)
- [x] NEW-2 and NEW-4 verified by direct measurement against the live DB, not by
      inspection alone

**Not live-tested:** the CSV/JSON import routes and the image-upload route were
verified by type-check and build only — exercising them would write real rows/objects
to the production Supabase project. Worth a manual pass before this ships.

---
---

# Pass 3 — three new features + bug check, 2026-07-28

Built on top of passes 1–2, same session. **Still not deployed.**

## Features

### 1. Chart shows more history
`range=6mo` → `range=2y` on the Yahoo chart fetch. Verified live: **501 daily
candles spanning 2024-07-29 → 2026-07-28**, up from ~130. The response now also
carries `currentPrice` / `dayHigh` / `dayLow` from Yahoo's quote meta, which is
what feature 2 watches.

### 2. Auto-execution on stop-loss / take-profit / entry touch
`src/lib/trades/use-auto-execute.ts` (new) + polling in `PriceChart.tsx`.
While a trade's page is open, the price is re-polled every 60s (and once
immediately on load); when a level is touched the trade advances itself:

- **pending → open** when the day's range brackets the entry price; stamps `entry_date`.
- **open → closed** when price touches the stop or the target: sets `status`,
  `exit_price` (to the level hit), `exit_date`, and `result` (loss/win).
  Direction-aware — for a long the stop is `dayLow <= stop_loss`, for a short it's
  `dayHigh >= stop_loss`, and vice-versa for the target.

A banner reports what fired ("Stop loss hit at $340 — trade closed."), and a pulsing
dot next to the live price shows when watching is active. Everything routes through
the normal autosave path, so each auto-execution lands in version history and can be
restored like any other edit.

**Deliberate design choices, all load-bearing:**
- **Stop wins an ambiguous day.** A single daily high/low can bracket *both* levels
  with no way to know which was touched first, so the stop takes the tie-break —
  an ambiguous session is never misfiled as a win.
- **Does nothing without `direction` set.** Without it there's genuinely no way to
  tell a stop-out from a take-profit, and guessing could record a loss as a win.
- **`result` is set from which level was hit, not from `dollar_pl`** — P/L
  additionally needs `shares`, which may be blank.
- Only polls when there's something to trigger (pending-with-entry, or
  open-with-a-level); a closed trade never polls.

**Known limitation, stated plainly:** this only runs while the trade's page is open
in a browser. There is no server-side watcher — a pending order sitting untouched
overnight will not fill itself. A real background watcher needs a scheduled function
(e.g. Netlify Scheduled Functions) and was out of scope here.

**Second known risk:** auto-execution acts on whatever symbol the chart resolved
(`guessSymbol`, or the user's saved per-ticker override). If that guess is wrong for
an unusual ticker, it would act on the wrong instrument's price. The resolved symbol
is visible and editable right there in the chart header, and a bad guess usually
404s (which no-ops), but it is not impossible to mis-fire.

**Verified live** against the demo account, four real scenarios, each with a
purpose-built trade that was deleted afterwards:
| scenario | result |
| --- | --- |
| pending, entry inside today's range | → open, entry_date stamped |
| open long, stop inside range | → closed / **loss** / exit = stop |
| open long, target inside range | → closed / **win** / exit = target |
| open long, **both** inside range | → closed / **loss** (stop wins tie-break) |

Plus regressions: a normal closed trade and an investment trade are both correctly
left alone (no banner, no polling).

### 3. "Needs attention" checklist (top right)
`src/lib/trades/missing-fields.ts` (new) + a pill button in the trade-card header
that expands into a list of what's still unfilled. Collapses to nothing when
complete. Per the brief: **take profit is never required**, and notes / custom
fields / strategy fields are never included.

Status-aware and settings-aware: entry date isn't asked for while an order is still
pending; exit price/date are only required once closed; any *one* of
shares / position size / dollar amount satisfies sizing; and anything the user has
hidden from their trade card is skipped.

## Bugs found and fixed during the check

### BUG-P3-1 · Polling rebuilt the entire chart every 60s — **High**, self-inflicted
The poll called `setCandles(data.candles)` with a brand-new array on every tick, and
the chart-building effect keys on `candles` — so **the whole chart was destroyed and
recreated every 60 seconds**, re-running `fitContent()` and throwing away whatever
the user had zoomed or panned to. This silently reintroduced the exact problem
PERF/NEW-3 fixed earlier in this same session.
**Fix:** a poll no longer touches `candles` state; it pushes just the latest bar
through `series.update()` (which replaces the last bar or appends a new one), so the
chart updates in place.
**Proven live:** tagged the chart `<canvas>`, let **7 polls** run, and confirmed the
*same* canvas element was still mounted — with the live price visibly advancing
($339.97 → $340.135), so the poll data was demonstrably still being applied.

### BUG-P3-2 · Checklist nagged investment trades for fields they don't have — **Medium**
Caught while reviewing, before it shipped: the required-field list asked investments
for Entry Price / Exit Price / position sizing. Those inputs are all inside the
`{!isInvestment && …}` "Entry information" card — an investment's cost basis and share
count live in mode-specific *custom* fields ("Average Cost", "Total Shares", seeded in
migration 0002+). The box would have demanded fields with no UI to fill them.
**Fix:** investment mode now only requires ticker (+ entry date once entered, exit
date once closed), and sizing is skipped entirely.

### BUG-P3-3 · Auto-execution's dismiss timer leaked past unmount — **Low**
The 10s banner timer wasn't cleared on unmount, leaving a pending `setState` on an
unmounted tree if the user navigated away inside the window. Added a cleanup effect.

## Verification (pass 3)

- [x] `tsc --noEmit` clean
- [x] `eslint src` — 0 errors, still the same 11 pre-existing warnings
- [x] `next build` succeeds (41 pages)
- [x] **22 assertions** on the timezone helper from pass 2 (`local-day.ts`), written
      during this check: both DST directions, half-hour (+5:30) and quarter-hour
      (+12:45) zones, month/year rollover, the original evening-EST bug, and 30
      round-trips across 6 timezones — **all pass**
- [x] **20 assertions** on `deriveStatusAndResult` (BUG-9) and `getMissingFields`:
      win/loss/break-even/short inference, explicit-column precedence, the exact
      BUG-9 "closed + open" contradiction, and every checklist rule above —
      **all pass**
- [x] Live: all four auto-execution scenarios, the checklist on blank/partial/complete
      trades, chart survival across 7 polls, and closed-trade + investment regressions

The two temporary test scripts were deleted after running; all six test trades
created on the demo account were deleted.

**ESLint note:** the linter twice caught genuine React-correctness mistakes in my own
new code during this pass (a ref written during render, and a `setState` inside an
effect body). Both were real, both were fixed properly rather than suppressed — the
one remaining `eslint-disable` is on a justified loading-state reset.

---
---

# Pass 4 — user testing feedback, 2026-07-28

Dev server started on **port 3000** for the user to test directly (not just via
Playwright). Two refinements from live feedback:

1. **Checklist pill is now always visible**, not hidden at zero. A complete trade
   shows a gray "0 to fill" with a green checkmark instead of the pill disappearing —
   the user couldn't tell if the feature was working when it silently vanished.
2. **Entry Date is now always required**, not skipped while a trade is "pending".
   Previously reasoned that a not-yet-triggered order shouldn't need a date; the user
   wanted it to count regardless of status. Simplified `missing-fields.ts` to a single
   unconditional required set per mode (removed the pending/entered split entirely).

Both verified live on port 3000: a complete trade shows "0 to fill" / green check with
"Nothing — this trade is fully filled in." in the dropdown; a pending trade with
ticker/direction/entry/stop set but no date now correctly shows "1 to fill" → "Entry
Date". `tsc`/`eslint` clean after each change. Test trades created for verification
were deleted immediately after.
