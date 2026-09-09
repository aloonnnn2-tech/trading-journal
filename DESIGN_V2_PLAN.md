# Design V2 — "Terminal Pro" — Plan & Coverage Tracker

Branch: `design/terminal-v2` (from `main` @ `37f544e`)
Status: **Phase 2 batch 1 of 9 done (landing + auth). 6 of 31 routes ready.**

Revert path: `git checkout main`. Nothing pushed, nothing deployed.

**Switch modes:** `localStorage.setItem('tl-design','v2'); location.reload()` — or append
`?design=v2` to any URL. `'v1'` / `?design=v1` switches back. In development a V1/V2 pill
sits in the bottom-right corner.

**V2 only applies to routes marked `done` below.** Turning the flag on does *not* restyle a
route that has not been redesigned yet — see §14. A route opts in by putting `data-v2-ready`
on its top-level wrapper; without it the route renders as V1 even with V2 on.

---

## 1. Baseline captured before any work

| Check | Result |
|---|---|
| `npx vitest run` | **65 files / 935 tests passed**, exit 0 |
| vitest environment | `node`, include `src/**/*.test.ts` only |
| Component/DOM tests | **none** — no `*.test.tsx` exists |
| Playwright specs | 3 (`auth`, `ocr-import`, `trade-autosave`) |

**This is the single most important finding for risk.** The 935 tests are pure logic over
`src/lib`; they never render a component. A presentation-layer change cannot break them
unless it edits `lib/`. The real regression surface is the 3 Playwright specs, which select
by accessible name — see §8.

---

## 2. Discovered architecture

| Concern | What is actually here |
|---|---|
| Styling system | **Tailwind CSS v4**, CSS-first. No `tailwind.config.*`. Config is `@import "tailwindcss"` + `@theme inline` inside `src/app/globals.css` (108 lines). |
| Where styles live | Almost entirely **utility classes inline in JSX**. ~18,100 lines of TSX across 66 `app/` files and 43 `components/` files. Only one hand-written stylesheet exists. |
| Tokens | `:root` / `.dark` custom properties in `globals.css`: `--background --foreground --color-primary --color-accent --color-profit --color-loss --color-deep --color-card --color-subtle`, plus `--chart-pos/neg/ref/grid/axis/muted`. Exposed to Tailwind via `@theme inline` as `bg-card`, `text-profit`, `border-subtle`, etc. |
| Dark mode | `next-themes`, `attribute="class"`, `defaultTheme="light"`, `enableSystem={false}`. The Tailwind variant is declared by hand: `@custom-variant dark (&:where(.dark, .dark *))`. So dark = a `.dark` class **on `<html>`** — the same element V2 will carry `data-design` on. |
| Fonts | `next/font/google`: **Inter** → `--font-inter`, **Geist Mono** → `--font-geist-mono`. Both are direct anti-pattern #10 hits. Wired into `@theme inline` as `--font-sans` / `--font-mono`; `body` sets `font-family: var(--font-inter)`. |
| Icons | `lucide-react` v1, imported in **28 files**. Size and stroke are set per call site (`h-4 w-4 strokeWidth={2}` and similar). |
| Charts | **recharts** in 7 files; **lightweight-charts** in `PriceChart.tsx` only. Chart colors already read CSS vars through `src/lib/theme/colors.ts` (`CHART`, `TICK`, `TOOLTIP_STYLE`). |
| Motion | **framer-motion** in 17 files, including `ui/Card.tsx` (`whileHover={{ y: -1 }}`, `whileInView` fade-up) and a global `PageTransition`. |
| CSP | `src/proxy.ts` sets `Content-Security-Policy-Report-Only` with `script-src 'self' 'nonce-...' 'strict-dynamic'`. The nonce reaches the layout through the `x-nonce` request header. `style-src 'self' 'unsafe-inline'`. `font-src 'self'`. |
| Tables already present | 13 files already render real `<table>` markup (trades, analytics panels, strategies, emotions, admin, import wizard). |

### Why this architecture is good news for a CSS-only V2

Tailwind v4 emits every utility inside `@layer utilities`. **An unlayered rule beats any
layered rule regardless of specificity.** So a plain, unlayered `src/styles/design-v2.css`
containing `html[data-design="v2"] .rounded-xl { border-radius: 2px }` wins over Tailwind's
own `.rounded-xl` without `!important` and without touching a single JSX file. That is the
mechanism the whole redesign hangs on, and it is why I expect very few markup changes.

---

## 3. Anti-pattern grep results

Counts are over `src/**` (`.tsx`, `.ts`, `.css`).

| # | Anti-pattern | Pattern | Files | Hits | Verdict |
|---|---|---|---|---|---|
| 1 | Gradients | `gradient` | 8 | 8 | Fix in V2 scope |
| 5 | Drop shadows | `shadow-{sm..2xl,[}`, `box-shadow`, `drop-shadow` | 22 | 30 | Fix; keep a 1px shadow on overlays only |
| 8 | Frosted glass | `backdrop-blur` | 4 | 5 | Fix (nav-bar, LandingHeader, PaidPlanModal, welcome-modal) |
| 19 | Large radius | `rounded-{xl,2xl,3xl,full}` | 61 | 162 | Fix — largest single count, but one CSS rule block covers all of it |
| 28 | Hover transforms | `hover:(scale\|translate)` | 0 | 0 | **Clean in CSS** — but see framer-motion, §5.1 |
| 25/28 | Animations | `animate-*` | 5 | 7 | 2 × `animate-ping` (decorative, remove in V2), 2 × `animate-spin` + 3 × `animate-pulse` (functional loading, keep and restyle) |
| 3 | Pure white / `#fff` | `bg-white`, `#fff(fff)?` | 36 | 63 | Fix via token remap |
| 24 | Sparkle icons | `Sparkles` | 7 | 18 | Remove in V2 — all 18 are on AI features, which is exactly the tell |
| 10 | Banned typefaces | `Inter\|Geist\|Space Grotesk` | 8 | 16 | Fix — IBM Plex Sans/Mono inside the V2 scope |
| 9 | Em dashes | `—` | 104 | 364 | **Mostly a false positive — see below** |
| 11 | Colored left stripe | `border-l-[248]`, `border-l-[` | 0 | 0 | Clean |
| 7 | Emoji | pictographic ranges | 0 | 0 | **Clean** |
| 12 | Fake testimonials | `testimonial\|trusted by\|customers say` | 0 | 0 | **Clean** — code comments show these were deliberately refused |
| 17 | Three pricing tiers | `PricingTeaser.tsx` | — | 0 | Clean — no tier cards exist |
| 22 | Radial orbs / glow | `radial-gradient`, `blur-2xl/3xl` | 3 | 3 | Fix (Hero, PricingTeaser, ThreePillars) |
| 23 | Dot-grid background | — | 0 | 0 | Clean |
| 6 | Three cards in a row | `*:grid-cols-3` | 8 | 8 | Evaluate per site; `ThreePillars.tsx` is a literal instance |
| 14 | Fake terminal mockup | manual review of `landing/illustrations.tsx` | — | — | To confirm in Phase 2 |
| 21 | No skeleton loaders | `loading.tsx` files | **1 of 26 routes** | — | **Biggest gap.** Only `/dashboard` has one. See §7. |
| 26/27 | No TOS / Privacy | `app/terms`, `app/privacy`, `app/cookies` | — | — | **Already exist.** Not a gap. |

### The em-dash number is misleading — read this before reacting to "364"

Broken down:

- **87 hits are `"—"` used alone as a null/empty-cell placeholder** in data tables
  (`value === null ? "—" : ...`). That is correct typography for a numeric table, not an AI
  copy tell. **I propose leaving all 87 alone**, and styling them `--text-3` in V2.
- **208 hits are in `src/lib`**, which is out of scope, and are overwhelmingly code comments.
- **13 hits sit on comment lines** in TSX.
- **Only 22 are prose em dashes** (`word — word`), and only **14** of those are on
  non-comment lines: `privacy` (5), `cookies` (3), `terms` (1), `contact` (1),
  `admin/plans` (1), `admin/analytics` (1), `insights/edge-panel` (1), `TradeCard` (1).

**Of those 14, the 9 in `privacy`/`cookies`/`terms` are legal text.** The spec forbids
writing legal pages, so I will not rewrite them. That leaves **5 genuine copy fixes**, which
I will list individually rather than silently rewrite.

---

## 4. The reversibility mechanism (Phase 1 build spec)

### 4.1 Flag storage and application

- Key `tl-design`, values `"v1"` (default) / `"v2"`. Anything else is treated as `v1`.
- Applied as `document.documentElement.dataset.design = "v2"`.
- An inline `<script>` in the root layout `<head>`, running **before first paint**, wrapped in
  `try/catch`, so a blocked or throwing `localStorage` silently yields `v1`.
- The same script reads `location.search` for `?design=v2` / `?design=v1` and writes the
  result back to `localStorage`, so a URL both applies the mode and persists it.
- Dev-only console hint: `localStorage.setItem('tl-design','v1');location.reload()`.

**CSP dependency:** `script-src` is `'self' 'nonce-...' 'strict-dynamic'` with no
`'unsafe-inline'`. The flag script **must** carry `nonce={nonce}`. The layout already pulls
that nonce from the `x-nonce` header for next-themes, so this costs nothing new — but if it
is forgotten, the flag dies silently the day CSP flips from Report-Only to enforcing, which
is a change already on the backlog.

### 4.2 Toggle pill

Fixed bottom-right, two segments `V1` / `V2`, 11px mono, no animation. Rendered only when
`process.env.NODE_ENV !== 'production'` **or** `localStorage.getItem('tl-design-toggle') === '1'`.
The `NODE_ENV` half is inlined at build time and dead-code-eliminated from a production
bundle, so its absence in production is provable rather than merely likely.

### 4.3 Isolation

- All V2 rules live in one new unlayered file, `src/styles/design-v2.css`, imported once at
  the end of `globals.css`.
- Every selector begins `html[data-design="v2"]`. I will add a grep check that fails on any
  rule in that file without the prefix, so requirement 6 is machine-checked, not eyeballed.
- Light V2 = `html[data-design="v2"]:not(.dark)`; dark V2 = `html[data-design="v2"].dark`.
  Because next-themes puts `.dark` on `<html>` and V2 puts `data-design` on the same element,
  the two palettes are one attribute selector apart. No nesting problem.
- No `data-design` branching inside React render, except through a single `useDesign()` hook
  that returns `'v1'` on first render — see §5.

---

## 5. Where CSS-only will not work (needs your decision)

I found **four** places, plus one optional addition. That is under the ~10 threshold in the
spec, so I do not think the CSS approach is wrong — but I want sign-off before writing any of
it.

### 5.1 framer-motion inline transforms — solvable in CSS, but not prettily

`ui/Card.tsx` sets `whileHover={{ y: -1 }}` and a `whileInView` fade-up. framer-motion writes
`style.transform` and `style.opacity` **directly onto the element**, so ordinary CSS loses.
`!important` does beat an inline style, so this works:

```css
html[data-design="v2"] [data-v2-flat] { transform: none !important; opacity: 1 !important; }
```

**Cost:** elements that animate in become visible immediately, which is the desired V2
behaviour anyway (motion is functional only). **Risk:** `opacity: 1 !important` would also
defeat legitimate fade-outs, so I will apply it narrowly to `Card` and `PageTransition`
rather than globally. **No markup change needed.**

### 5.2 `StatCard` grid → stat *row* — needs markup

Part 2 explicitly wants "a single bordered strip divided by vertical hairlines", not four
cards. Four sibling cards cannot become one divided strip by CSS alone; the border structure
is genuinely different. Consumers: `dashboard/page.tsx`, `analytics/page.tsx`,
`admin/analytics/page.tsx`, `dashboard/account-cash-card.tsx`.
**Proposal:** one `useDesign()` guard inside `StatCard`'s wrapper only. 1 component.

### 5.3 Card grids that should become tables — needs markup, and I want to cap it

13 files already use real `<table>`, so those are pure CSS. The genuine
card-grid-of-homogeneous-data cases I would convert are `strategies`, `goals`, `commissions`
and `fields`. That is 4 more `useDesign()` components, for a running total of 5.
**Proposal:** convert **only** where the card contents are homogeneous, and if the count
would exceed ~6 components I stop and come back to you, as the spec instructs.

### 5.4 Recharts `TOOLTIP_STYLE` / `TICK` are JS objects, not CSS

`src/lib/theme/colors.ts` hard-codes `borderRadius: 10`, a `boxShadow`, `fontSize: 12` and
`fontFamily: var(--font-geist-mono)` as inline styles on the tooltip. CSS can override all of
them inside the V2 scope with `!important` on the recharts tooltip class.
**Proposal: CSS override; do not touch `colors.ts`,** which keeps me out of `lib/` entirely.

### 5.5 A persistent status bar — new markup, opt-in

Part 2 calls this "the strongest single professional-terminal signal". It is genuinely new UI
(open positions, period P&L, last sync time) and it needs real data, which risks crossing into
data fetching — explicitly out of scope. **Proposal: defer to a Phase 2 decision point.** If
you want it, I will feed it only from data the dashboard already fetches and render it
V2-only.

---

## 6. Conflicts between Part 2 and the existing architecture

| Conflict | Detail | Proposal |
|---|---|---|
| **Adding IBM Plex changes the `<html>` DOM even in V1** | `next/font` injects one class per font. Adding Plex Sans and Plex Mono appends two class names and two `<style>` blocks to the document **regardless of the flag**. Requirement 2 asks for identical rendering to `main`. | **ACCEPTED (see §13, exception 1).** Requirement 2 means visually identical, not a byte-identical DOM string. Verified: 0 computed-style differences. |
| **13px base vs Tailwind's `text-sm` / `text-base` scale** | The app uses `text-xs/sm/base` everywhere; Part 2 wants a 10/11/12/13/15/18/24/32 ramp on a 13px base. | Remap the Tailwind size utilities *inside the V2 scope* rather than rewriting class names across 66 files. One rule block, zero JSX churn. |
| **`--color-primary` is a bright blue doing five jobs** | It drives buttons, focus rings, links, charts and meters. Part 2 permits exactly one accent (`#C8862A` amber) and says a color that means nothing is a bug. | Remapping `--color-primary` inside V2 is a one-property change, but it repaints nearly everything at once. Flagging so the first V2 commit is not a shock. |
| **`.dark` is the theme mechanism; V2 wants dark as its default** | Part 2 says dark is "the default for V2", but next-themes has `defaultTheme="light"` and `enableSystem={false}`. Changing that default would change V1 behaviour. | **Do not change the theme default.** V2 will be complete in both modes; switch the app to dark and you get V2-dark. I will not touch `ThemeProvider` props. |
| **`box-shadow` ban vs the existing global transition rule** | `globals.css` transitions `transform` and `box-shadow` on every `a, button, select, input, summary`, and `button:active { transform: scale(0.98) }`. | Override inside the V2 scope to `opacity, background-color` at ≤120ms, and `transform: none` on `:active`. The V1 rule is untouched. |
| **Density vs the accessibility floor** | 28px rows conflict with "hit targets ≥32px on desktop". | Rows may be 28px tall visually while the interactive element inside gets to 32px through padding; where that is impossible the row goes to 32px. **I will treat 32px desktop / 40px mobile as hard floors and let density lose,** and list every such spot in the final report. |

---

## 7. Requirement 9 — loading and empty states is the largest *additive* task

Only `/dashboard` has a `loading.tsx`. **25 routes have none.** This is not restyling, it is
new files, and a `loading.tsx` renders regardless of the flag — so each new skeleton would
change V1's rendered output, where V1 currently renders nothing at all.

This is the one place where the "V1 must be identical" rule and requirement 9 genuinely
collide. Two options, question 2 in §11.

---

## 8. Protected strings — do not rewrite (Playwright selectors)

Any copy edit to these breaks E2E: `Sign in`, `Sign out`, `Sign up` / `Create account`,
`Add trade`, `Create trade`, `From screenshot`, `Explore on my own`, `Password`,
`Autosave on` / `Saved`, `Check your email`, `Dollar P/L`, and `role="alert"` on form errors.

There are **no `data-testid` attributes anywhere in `src/`**, so class names are free to change.

---

## 9. Coverage tracker

### 9.1 Routes and root-level files

| Route | File | Notes | Status |
|---|---|---|---|
| `/` | `app/page.tsx` | **done** — hairline bands, 32px headline, fake window chrome removed | done |
| `/account` | `app/account/page.tsx` | + `delete-account-section.tsx` | todo |
| `/admin/analytics` | `app/admin/analytics/page.tsx` | tables + 2 recharts | todo |
| `/admin/plans` | `app/admin/plans/page.tsx` | + `plan-manager.tsx` | todo |
| `/analytics` | `app/analytics/page.tsx` | densest page; 6 panels + 3 charts | todo |
| `/ask` | `app/ask/page.tsx` | Sparkles ×4; AI answer prose | todo |
| `/commissions` | `app/commissions/page.tsx` | card grid → table candidate | todo |
| `/contact` | `app/contact/page.tsx` | 1 prose em dash | todo |
| `/cookies` | `app/cookies/page.tsx` | legal; has a table; copy frozen | todo |
| `/dashboard` | `app/dashboard/page.tsx` | reference-page candidate | todo |
| `/emotions` | `app/emotions/page.tsx` | already a table | todo |
| `/fields` | `app/fields/page.tsx` | 3 managers | todo |
| `/forgot-password` | `app/forgot-password/page.tsx` | **done** — all 2 return branches marked | done |
| `/goals` | `app/goals/page.tsx` | card grid → table candidate | todo |
| `/insights` | `app/insights/page.tsx` | 3 panels + chart | todo |
| `/privacy` | `app/privacy/page.tsx` | legal; copy frozen | todo |
| `/reports` | `app/reports/page.tsx` | **only route with print styles** | todo |
| `/reset-password` | `app/reset-password/page.tsx` | **done** — all 3 return branches marked | done |
| `/reviews` | `app/reviews/page.tsx` | Sparkles ×2 | todo |
| `/sign-in` | `app/sign-in/page.tsx` | **done** — Turnstile iframe chrome is third-party, untouched | done |
| `/sign-up` | `app/sign-up/page.tsx` | **done** — all 2 return branches marked | done |
| `/strategies` | `app/strategies/page.tsx` | tables + scorecards | todo |
| `/terms` | `app/terms/page.tsx` | legal; copy frozen | todo |
| `/trades` | `app/trades/page.tsx` | **reference page — done in Phase 1** | done |
| `/trades/[id]` | `app/trades/[id]/page.tsx` | hosts the 1013-line TradeCard | todo |
| `/trades/import` | `app/trades/import/page.tsx` | wizard, table preview | todo |
| root layout | `app/layout.tsx` | hosts the flag mechanism; no design pass of its own | n-a |
| error boundary | `app/error.tsx` | 1 shadow | todo |
| global error | `app/global-error.tsx` | renders its own `<html>` — needs its own V2 handling | todo |
| 404 | `app/not-found.tsx` | 1 shadow | todo |
| dashboard loading | `app/dashboard/loading.tsx` | the only existing skeleton | todo |
| loading states ×25 | *(new files)* | pending decision, §7 | todo |

### 9.2 Route-local components

| File | Status |
|---|---|
| `account/delete-account-section.tsx` | todo |
| `admin/admin-tabs.tsx` | todo |
| `admin/analytics/feature-usage-chart.tsx` | todo |
| `admin/analytics/usage-line-chart.tsx` | todo |
| `admin/plans/plan-manager.tsx` | todo |
| `analytics/drawdown-panel.tsx` | todo |
| `analytics/equity-drawdown-chart.tsx` | todo |
| `analytics/excursion-panel.tsx` | todo |
| `analytics/performance-panel.tsx` | todo |
| `analytics/r-multiple-histogram.tsx` | todo |
| `analytics/regime-panel.tsx` | todo |
| `analytics/risk-panel.tsx` | todo |
| `ask/answer-text.tsx` | todo |
| `ask/ask-manager.tsx` | todo |
| `ask/key-form.tsx` | todo |
| `commissions/commission-manager.tsx` | todo |
| `dashboard/account-cash-card.tsx` | todo |
| `dashboard/dashboard-grid.tsx` | todo |
| `dashboard/monthly-calendar.tsx` | todo |
| `dashboard/performance-chart.tsx` | todo |
| `fields/core-field-toggles.tsx` | todo |
| `fields/field-manager.tsx` | todo |
| `fields/folder-manager.tsx` | todo |
| `goals/goal-manager.tsx` | todo |
| `insights/edge-panel.tsx` | todo |
| `insights/insight-chart.tsx` | todo |
| `insights/mistake-tracker.tsx` | todo |
| `reports/report-view.tsx` | todo |
| `reviews/reviews-manager.tsx` | todo |
| `strategies/rule-manager.tsx` | todo |
| `strategies/scorecards.tsx` | todo |
| `strategies/strategy-manager.tsx` | todo |
| `trades/import/import-wizard.tsx` | todo |
| `trades/new-trade-button.tsx` | todo |
| `trades/screenshot-trade-button.tsx` | todo |

### 9.3 Shared components

| File | Notes | Status |
|---|---|---|
| `ui/Card.tsx` | `data-v2-flat` hook added; full pass due in batch 1 | todo |
| `ui/StatCard.tsx` | gradient meter, icon chip; markup change per §5.2 | todo |
| `ui/InfoTip.tsx` | rounded-full | todo |
| `nav-bar.tsx` | backdrop-blur, 2 shadows, `print:hidden` | todo |
| `brand-mark.tsx` | 6 lines | todo |
| `field-input.tsx` | every form control state lives here | todo |
| `form-error.tsx` | `role="alert"` — do not change its text | todo |
| `turnstile.tsx` | third-party iframe; only surrounding chrome is ours | todo |
| `page-transition.tsx` | `data-v2-flat` hook added; applies only on ready routes | todo |
| `motion/StaggerGrid.tsx` | framer-motion; neutralise in V2 | todo |
| `theme-provider.tsx` | **n-a** — renders no markup, and its props must not change (§6) | n-a |
| `analytics-tracker.tsx` | **n-a** — returns null | n-a |
| `track-page-view.tsx` | **n-a** — returns null | n-a |
| `keyboard-shortcuts.tsx` | **n-a** — returns null | n-a |
| `tour/tour-overlay.tsx` | 3 shadows; an overlay, so the 1px shadow is allowed | todo |
| `tour/welcome-modal.tsx` | backdrop-blur, shadow; "Explore on my own" is a frozen string | todo |
| `ocr/ConfidenceBadge.tsx` | rounded pill | todo |
| `ai/provider-consent-card.tsx` | todo |
| `ai-review/period-review-card.tsx` | todo |
| `ai-review/trade-review-card.tsx` | todo |
| `trade-card/TradeCard.tsx` | 1013 lines; `animate-ping` | todo |
| `trade-card/PriceChart.tsx` | lightweight-charts; colors set in JS | todo |
| `trade-card/ImageUploader.tsx` | file-upload states | todo |
| `trade-card/ai-review-panel.tsx` | Sparkles ×3 | todo |
| `trade-card/excursion-panel.tsx` | todo |
| `trade-card/plan-adherence-panel.tsx` | todo |
| `trade-card/tag-suggestions-panel.tsx` | todo |
| `trade-card/trade-history-panel.tsx` | todo |
| `trade-card/trade-timeline.tsx` | todo |
| `landing/Hero.tsx` | gradient + orb removed | done |
| `landing/LandingHeader.tsx` | flat, opaque, 44px | done |
| `landing/LandingFooter.tsx` | 11px hairline strip | done |
| `landing/ThreePillars.tsx` | now one hairline-ruled block, `data-v2-cards` | done |
| `landing/FeatureGrid.tsx` | bento flattened, `data-v2-cards`; Sparkles still to remove | partial |
| `landing/FeatureStories.tsx` | two-column stories, tightened | done |
| `landing/FeatureStory.tsx` | `align-items: start`, 20px gap | done |
| `landing/HowItWorks.tsx` | square step markers, gradient rule gone | done |
| `landing/PricingTeaser.tsx` | glow gone; Sparkles still to remove | partial |
| `landing/ClosingCTA.tsx` | flat band | done |
| `landing/SectionHeadline.tsx` | left-aligned, 18px | done |
| `landing/CategoryTag.tsx` | todo |
| `landing/PaidPlanModal.tsx` | 578 lines; backdrop-blur ×2, Sparkles ×3 | todo |
| `landing/illustrations.tsx` | **#14 confirmed and fixed** — the window dots, fake breadcrumb and "live" pip are hidden in V2; the dense figures underneath are kept. SVG axis labels and bar corners corrected via CSS | done |

**Totals:** 26 routes + 5 root-level route files + 35 route-local components + 43 shared
components = **109 tracked items**, 4 of them `n-a`.

---

## 10. Proposed batching for Phases 1–2

**Phase 1** — flag mechanism, `design-v2.css` token/type/base layer, V1-identity
verification, then **`/trades` as the reference page**: it is the densest real table, has the
most numerics, and exercises the type ramp and table treatment harder than anything else.
Stop for sign-off.

**Phase 2**, shared components before the pages that consume them:

1. `ui/*`, `field-input`, `form-error`, `nav-bar`
2. `/dashboard`, `/analytics`, `/insights`
3. `trade-card/*` + `/trades/[id]`, `/trades/import`
4. `/strategies`, `/goals`, `/commissions`, `/emotions`
5. `/reviews`, `/ask`, `ai/*`, `ai-review/*`
6. `/fields`, `/account`, `/reports` (including print), `/admin/*`
7. Auth: `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`, `turnstile`
8. `landing/*` + `/`, `/contact`, legal pages
9. `error`, `global-error`, `not-found`, `tour/*`, and the new `loading.tsx` files

---

## 11. Decisions — answered

All five were settled before Phase 1 began. Recorded here so they are not reopened.

1. **Font/script DOM exception — accepted.** Requirement 2 means visually identical, not a
   byte-identical DOM string. See §13.
2. **Skeletons — build all 25 once, inert under V1.** The markup ships hidden
   (`<div data-v2-skeleton hidden>`) and V2 reveals it, so V1 keeps its current behaviour of
   showing nothing while a route loads. Written that way round — V2 revealing rather than V1
   hiding — so 100% of the CSS stays inside the V2 scope and requirement 6 still holds.
   Mechanism is built (design-v2.css §12); the 25 files land in Phase 2 batch 9.
3. **Status bar — deferred** to after Phase 2 coverage.
4. **The 5 prose em dashes — fix them now.** Phase 2, alongside the pages they sit on.
5. **~6-component `useDesign()` budget — approved.** Spent so far: **0**. Everything in
   Phase 1 was CSS plus inert `data-*` attributes.

---

## 12. Flagged, not fixed (Part 1 says these are out of scope)

- **#18, no real product demo** — there are no screenshots or recordings of the actual app on
  the landing page. Content gap, yours to handle.
- **#26 Terms of Service / #27 Privacy Policy** — **not gaps.** `/terms`, `/privacy` and
  `/cookies` all exist. Recorded here so they are not re-flagged later.
- **#12 fake testimonials** — none found anywhere. Nothing removed.


---

## 13. Phase 1 record

### What was built

| Piece | File |
|---|---|
| Flag constants + pre-paint script | `src/components/design/design-flag.tsx` |
| `useDesign()` hook (unused so far) | `src/components/design/use-design.ts` |
| Dev V1/V2 toggle pill | `src/components/design/design-toggle.tsx` |
| The entire V2 stylesheet | `src/styles/design-v2.css` |
| Scope enforcement | `scripts/check-design-v2-scope.ts`, `npm run check:design-v2` |

Markup changes were limited to **inert `data-*` attributes** — `data-v2-flat`,
`data-v2-page`, `data-v2-overlay`, `data-v2-empty`, `data-num`, `data-v2-toggle`. None of
them changes a rendered pixel in V1, and none needs a hydration guard. **The `useDesign()`
budget is untouched: 0 of ~6 spent.**

### The two accepted V1 DOM exceptions

Both are inert with the flag off, and both are unavoidable — the font and the flag must be
in the document before the flag's value is known:

1. Two extra `next/font` class names on `<html>` plus their `<style>` blocks (IBM Plex Sans,
   IBM Plex Mono). No V1 rule consumes `--font-plex-*`.
2. One nonced inline `<script>` in `<head>` that sets `data-design`. For V1 it *removes* the
   attribute rather than writing `"v1"`, so the V1 `<html>` element is unchanged.

Nothing else differs. Any future difference is a regression, not a third exception.

### Verification actually run — not assumed

**Requirement 2, V1 identity.** 26 computed properties captured for every element on 7
routes (`/`, `/sign-in`, `/sign-up`, `/forgot-password`, `/terms`, `/privacy`, `/contact`),
on this branch and on `main`, in both themes:

| Comparison | Nodes | Property differences |
|---|---|---|
| `main` vs branch, V1 light | 805 | **0** |
| `main` vs branch, V1 dark | 837 | **0** |

The same harness confirms V2 is doing real work: 5,380 property differences in light and
5,572 in dark between V1 and V2 on those same nodes.

**Requirements 3 and 4, the flag.** Fresh visit → no attribute. `?design=v2` → attribute set
and persisted. Plain reload → still V2. `?design=v1` → attribute removed and persisted. A
garbage value (`banana`) → treated as V1. The flag `<script>` is inside `<head>`, before
first paint, carrying the CSP nonce.

**Requirement 6.** `npm run check:design-v2` reports all 88 rules scoped. The checker was
itself tested against injected leaks at top level and nested inside `@media`; it catches both
and exits non-zero.

**Requirement 8, on `/trades` in V2**, counted from the live DOM in both themes:
gradients 0, `backdrop-filter` 0, radius over 2px 0, Inter/Geist/Space Grotesk 0, controls
under 32px 0, `box-shadow` 1 — the export dropdown, which is a genuine overlay and the one
permitted exception.

**Requirement 12.** `npx vitest run` → 65 files, 935 tests passed. Identical to the baseline
taken before the branch.

### Two bugs found and fixed during verification

- **Lightning CSS silently dropped a declaration.** Writing `backdrop-filter: none` and
  `-webkit-backdrop-filter: none` as a pair made the build treat them as duplicates and emit
  *only* the prefixed one, which Chromium ignores — the nav bar kept its blur. Fixed by
  writing the unprefixed property alone and leaving prefixing to the build. Worth
  remembering: **the compiled CSS is not always what was written.**
- **My own density rule broke the accessibility floor.** The `/trades` filter tabs were set
  to `min-height: 26px`, which is denser but below the 32px desktop hit target. Raised to
  32px, and every control and control-link on the page now clears it. Where density and the
  hit-target floor collide, the floor wins.

### Density result

Same 1512×950 viewport, same account: V1 shows **11 trade rows**, V2 shows **23**. Row
height 45px → 29.8px, base font 16px → 13px, page gutter 32px → 20px.

### What V2 looks like now

Paper (`#f5f4f1`) or near-black (`#0b0d0f`) ground, never white. IBM Plex Sans at 13px, IBM
Plex Mono with tabular figures for every number. 10px uppercase column headers on a stepped
header band with a stronger rule under it. Square corners, hairline separation, no shadows,
no blur, no gradients. One muted amber accent marking only the active thing; green and red
reserved for gain and loss.

**The accent change is the loudest single difference and it is deliberate.** `--color-primary`
was a bright blue doing five unrelated jobs; in V2 it is one muted amber that means "active,
focused, or selected" and nothing else. Every blue button, link, tab and chart stroke in the
app changed colour in one token edit.


---

## 14. The route-readiness gate (added after Phase 1 review)

### The bug

Phase 1 scoped every V2 rule to the flag alone: `html[data-design="v2"] ...`. The flag is
global, so the moment it went on, **all 26 routes** got the base sweep — the radius, shadow,
blur, gradient and palette overrides — while only `/trades` had received the type, spacing
and layout pass that makes a stripped-down surface look deliberate.

On the landing page the result was not "redesigned", it was **broken**: the hero and the
three feature cards collapsed into large empty voids, because the type shrank to 13px while
the layouts around it kept their original heights, and the decorative blur orbs the spacing
leaned on were set to `display: none`. That page is what every visitor sees before they ever
reach the app, and Phase 1 was never supposed to touch it.

The root cause is exactly as diagnosed in review: **the sweep was scoped to the flag, not to
"pages that have actually been redesigned."**

### The fix

Every rule now carries two gates:

```css
html[data-design="v2"]:has([data-v2-ready]) ...
```

A route opts in by putting `data-v2-ready` on its top-level wrapper. Until it does, the flag
has no effect on it whatsoever. Untouched routes render as V1, not as partially-stripped V1.

`npm run check:design-v2` now requires **both** gates and fails the build on a rule carrying
only the flag — which is precisely the mistake that caused this. Verified against an injected
flag-only rule: it is rejected with the missing gate named.

### Why `:has()` on `<html>` rather than a descendant of the marker

The literal form suggested in review was `html[data-design="v2"] [data-v2-ready] ...`. I used
`:has()` at the root instead, because the nav bar, the body background and the footer live
*outside* the page wrapper in the root layout. Descendant scoping would style the page but
never its chrome, leaving every redesigned route permanently sitting under a V1 nav bar. With
`:has()` the whole document flips together, so a route is entirely V2 or entirely V1 and
never a mixture.

It also fails safe: if `:has()` were unsupported, the selectors would be invalid and dropped
entirely, which yields V1 everywhere rather than a broken V1.

### Verified after the fix

| Check | Result |
|---|---|
| 7 un-ready routes, flag off vs flag on, light | 805 nodes, **0 differences** |
| 7 un-ready routes, flag off vs flag on, dark | 837 nodes, **0 differences** |
| `/trades` (ready) still fully V2 | Plex 13px, paper ground, 29.8px rows, nav blur gone, 0 violations |
| Checker rejects a flag-only rule | yes, names the missing gate |

The landing page under the flag is now identical to V1 in both themes — the flag is inert
there until its own design pass lands.


---

## 15. Phase 2 — batch 1: landing and auth

Routes now marked ready: `/`, `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`,
plus `/trades` from Phase 1. **6 of 31.** Everything else still renders as V1 under the flag.

### Landing

Bands separated by hairlines instead of 96px of air; 32px headline (the only place the scale
reaches 32); left-aligned rather than centred; the three pillars and the feature bento are now
single hairline-ruled blocks rather than rows of floating cards. Page height fell from roughly
6,000px to **3,519px** for the same content.

**Anti-pattern #14 was real and is fixed.** `illustrations.tsx` drew a fake app window — three
grey dots, a `dashboard / overview` breadcrumb and a green "live" pip. That chrome is hidden in
V2. The dense figures inside it are kept: they are a hand-built HTML/SVG illustration of real
product output, which is the opposite of the thing the anti-pattern bans. This does **not**
close #18 — there is still no screenshot or recording of the actual app.

### Auth

One hairline panel per screen, uppercase micro-labels, square accent submit. `/sign-up`,
`/forgot-password` and `/reset-password` each return from **several branches** (form, sent,
error) and every branch carries the marker — otherwise one state of a flow would drop back to
V1 mid-journey. The Turnstile widget is a third-party iframe and is left alone.

### Four bugs found and fixed in this batch

1. **The density block only moved one axis.** §6 overrode `py-*` but not `pt-*`/`pb-*`, so the
   hero kept 96–112px of padding around 13px type. That was the single biggest contributor to
   the "broken, not redesigned" look. Both axes now move together.
2. **Class-substring matching caught the wrong grids.** A rule aimed at card rows also hit the
   hero's two-column grid and the two-column feature stories, painting grey bands where
   `items-center` left a column short. Replaced with an explicit `data-v2-cards` marker on the
   two grids that really are card rows.
3. **Fixed panel heights outlived their type.** The pillars carry `md:min-h-[19rem]` with
   `mt-auto` on the body copy, both sized for 16px text. At 13px the box no longer filled and
   opened a ~150px void in each card.
4. **framer-motion left whole sections invisible.** Sections fade in on scroll, so anything
   below the fold sat at `opacity: 0` while still occupying its height. V2 drops the animation,
   which also makes the page reviewable in a full-page screenshot.

### Verified

| Check | Result |
|---|---|
| Landing in V2: shadows / radius>2 / gradients / backdrop / banned fonts / controls <32px | **0 / 0 / 0 / 0 / 0 / 0** |
| Elements left invisible by motion | **0** |
| Un-ready routes (`/terms`, `/privacy`, `/contact`, `/cookies`), flag off vs on, light | 269 nodes, **0 differences** |
| Un-ready routes, dark | 301 nodes, **0 differences** |
| `npx vitest run` | 65 files, **935 passed** |
| `npm run check:design-v2` | all 145 rules carry both gates |

Two ESLint warnings remain in `sign-in`/`sign-up` (`window.location.href`). Both are on `main`
already and are unrelated to this work.

### Still open on these routes

- `Sparkles` icons remain in `FeatureGrid` (×2) and `PricingTeaser` (×2) — removing an icon is
  a markup edit, batched with the other 14 Sparkles usages in a later pass.
- `PricingTeaser` and `ClosingCTA` have had the band and panel treatment but not a close read
  of their internal copy and spacing.
