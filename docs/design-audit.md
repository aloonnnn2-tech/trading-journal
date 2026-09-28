# Trading Lens: design audit implementation spec

Source: competitor design audit, 23 Sep 2026. It compared Trading Lens with TradeZella, Tradervue, Tradinjournal and TraderWaves. This file is the working spec. The original PDF isn't needed to do the work.

## Goal

Make the public homepage (`tradinglenz.netlify.app`) read as a serious, trustworthy trading journal next to those four competitors, and fix the app bugs the audit found. The visual base already fits the category. What's missing:

1. **Trust sections:** proof strip, FAQ, compare table, full footer.
2. **Page quality:** sections that stay blank while you scroll, counters that start from zero, mixed money formats.

## The one rule that overrides everything

**Never show a number, name, quote or claim that isn't true today.** Trading Lens runs on the idea that "a made-up number is worse than no number."

- No invented user counts, trade counts, ratings, review scores, testimonials or broker counts.
- No broker or platform names that aren't in the **Facts Alon supplies** section below.
- Numbers counted live from the database may appear only once Alon approves them in writing. Don't add them on your own.
- If a section needs a fact that isn't in this file or provable from the code, **stop and ask**. Don't use a placeholder that could ship.

## Context

- **Stack:** Next.js 16 (App Router), React 19, TypeScript, Supabase, Netlify. Tests are vitest only. There are no component or E2E tests.
- **Stats:** every computed statistic comes from one engine (`segments/engine.ts`). Don't add a second place that calculates the same stats.
- **Migrations:** numbered SQL files in `supabase/migrations/`. **Nothing runs them automatically.** Alon applies them by hand in the Supabase SQL editor. **Always check the actual latest number** with `ls supabase/migrations | tail -1` and take the next one — do not trust a number written down anywhere, including here. (This file said "0000–0039" until 23 Sep 2026, by which point the real latest was 0048.) The PR description must say "migration NNNN must be applied manually before deploy."
- **Rate limiting:** a **global** limiter already exists (`src/lib/rate-limit.ts`: `enforceRateLimit`, `clientIpKey`), backed by a shared Postgres counter since migration 0042. Reuse it. Sign-in, sign-up and forgot-password do have a CAPTCHA (Cloudflare Turnstile), but Supabase verifies its tokens, not this app, so a new public form of ours can't reuse it without a new server secret; use a honeypot field. *(Corrected 27 Sep 2026 from the code: this line said "per-instance" and "auth screens have no CAPTCHA"; both were wrong.)*
- **Separate redesign:** a terminal-style app redesign lives on its own git branch behind a localStorage flag. **Don't touch that flag or its code.** Everything in this spec goes on normal branches off `main`.
- **Current homepage order:**
  1. header
  2. hero ("See the pattern behind every trade.")
  3. keyword ticker
  4. coded dashboard preview
  5. Find My Edge screenshot with demo-data caption
  6. 3-step carousel (Upload → Extract → Review)
  7. 3 feature spotlights
  8. "What's included" (12 FREE/PAID cards)
  9. "Three jobs a plain record leaves to you"
  10. paid plan preview (UNDER CONSTRUCTION)
  11. pricing (free card only)
  12. final CTA
  13. thin footer

## What to keep

- The copy tone. It's specific and honest, and no competitor matches it. Don't rewrite existing copy unless a task says to.
- FREE/PAID labels on every feature.
- A single CTA wording everywhere: **"Start journaling free"**.
- The dark neutral base, one blue accent, Inter + Geist Mono.
- The demo-data caption ("Figures come from the demo account, so they are seeded rather than anyone's real trading history").

## What to avoid

- Purple or violet-to-pink gradients. They read as an AI-generated template.
- Pressure tactics ("126 people signed up in 24h", countdowns, fake scarcity).
- Pill-shaped buttons. Main buttons use 8px corners.
- All-caps button text, and 800–900 weight body text.
- Adding new animation libraries.

---

## Design tokens

Add these as CSS variables in the global stylesheet (and in the Tailwind theme, if one is used) **before** building new sections.

| Token | Now | Target |
|---|---|---|
| Page background | `#101010` | keep |
| Raised band (alternating sections) | — | `#161615` |
| Hero/CTA band | — | `#0E1A2E` |
| Card | `#1A1A19` | keep |
| Main text | `#ECEAE4` | keep |
| Accent | `#4D8EF7` | keep; hover `#6AA2FA` |
| Profit / Loss | `#10B981` / `#F87171` | keep |
| H1 (desktop) | 600 weight | 56–64px, weight 700, letter-spacing −2% |
| H2 (desktop) | 30px / 600 | 36–40px, weight 700 |
| Eyebrow labels | Geist Mono caps | keep; use on every section |
| Numbers | mixed | Geist Mono, `font-variant-numeric: tabular-nums`, always with thousands separators |
| Buttons | 8px + one pill | 8px everywhere |
| Motion | long fade-ins | ≤250ms, content visible by default, none under `prefers-reduced-motion: reduce` |

Headlines have exactly one colored keyword or phrase in accent blue, never more.

Section backgrounds alternate `#101010` / `#161615`. The final CTA band uses `#0E1A2E`.

---

## Issues to fix

Priority: **P1** = quick win, **P2** = 1–2 weeks, **P3** = polish.

### App

1. **P1: Nav overlap at ~850px.** The "Setup ▾" label runs into the help (?) icon. The top bar holds 6 menus, 4 icons and "Sign out".
   - **Fix:** below 1000px, move Setup, help and Sign out into the account menu.
   - **Done when:** at 768, 850, 1000 and 1280px no nav items overlap or wrap.
2. **P1: The tour toast won't go away.** "PAID PLAN · Everything just unlocked · A 10-step tour… Later / Show me" is pinned bottom-center on every page and covers table rows.
   - **Fix:** show it at most once per session. "Later" hides it for 7 days, and "Show me" or finishing the tour hides it for good.
   - **Storage:** persist the state per user, in the database if a settings row exists, otherwise in localStorage wrapped in try/catch.
   - **Placement:** move it to a small corner card that never covers the table.
3. **P1: Money formatting is inconsistent.** The dashboard shows `$78,622`, but Analytics shows `$13621.59` and the best/worst setup shows `+$8475.82` / `−$1360.21`.
   - **Fix:** one shared formatter built on `Intl.NumberFormat`, used everywhere money is shown:
     - thousands separators and 2 decimals, e.g. `$13,621.59`
     - sign before the currency, e.g. `+$8,475.82` and `−$1,360.21`
     - use the account currency if the app stores one, otherwise USD
     - tabular figures
   - **Tests:** add vitest cases for positive, negative, zero, large values and rounding.
   - **Done when:** a repo search finds no `toFixed(` or hand-built `${…}` string used to display money outside the formatter.
4. **P2: Analytics loads blank.** The page is mostly empty for 1–2s while cards fade in.
   - **Fix:** show skeleton placeholders right away, render stat cards without fade-ins, and animate only the charts (≤250ms).
5. **P2: The trade chart is zoomed out too far.** It shows about 2 years of daily candles, so the entry, stop, breakeven and target lines are squashed together.
   - **Fix:** open the chart on the holding period, from a few bars before entry to a few bars after exit (or to today if the trade is open).
   - **Markers:** draw ▲ at the entry bar and ▼ at the exit bar. For shorts, flip the direction.
   - **Done when:** stop, entry and target lines are clearly separated on the TSLA trade from 2 Sep 2026.
6. **P3: Unexplained "L" / "M" letters on dashboard card headers** (Performance, This month, Recent trades, Recent emotions, Recent notes).
   - **Fix:** replace them with a size icon plus a tooltip, or hide them outside an edit-layout mode.

### Homepage

7. **P1: Scroll animations leave the page blank.** Sections stay empty for over a second while scrolling.
   - **Fix:** content is visible by default (no initial `opacity: 0` in the server HTML). Any motion is a ≤250ms, ≤8px upward fade that starts before the section enters the screen (e.g. IntersectionObserver `rootMargin: "0px 0px 20% 0px"`), with no motion under `prefers-reduced-motion: reduce`.
8. **P1: Counters start from zero.** The hero preview first shows "Win rate 6%, Profit factor 0.15", and the paid preview shows "0/100", "0% CAPTURED".
   - **Fix:** render final values in the server HTML. Remove number count-up animations entirely. Animating the chart line is fine.
   - **Done when:** `curl` on the homepage returns HTML with the final values (54%, 1.42, +$4,928.61, 78/100, etc.).
9. **P1: "UNDER CONSTRUCTION" badge.**
   - **Fix:** relabel it "COMING SOON" and add the waitlist form (see Phase 2).
10. **P1: Weak metadata.** The title is just "Trading Lens" and the description is generic.
    - **Fix, title:** `Trading Lens — Free Trading Journal That Grades Every Trade Against Your Rules`.
    - **Fix, description:** 140–160 characters naming trading rules, mistake tracking, MAE/MFE, screenshot import, and "free, no card".
    - **Fix, share image:** add Open Graph and Twitter card images via `opengraph-image.tsx` (`next/og`), 1200×630, dark background, wordmark, H1 text.
11. **P3: Mixed button shapes.** "See what's inside" is a pill while every other main button is an 8px rectangle.
    - **Fix:** 8px everywhere.

---

## Target homepage order

`NEW` = doesn't exist today.

1. **Announcement bar** `NEW`: "Paid plan in the works: AI reviews that grade execution, not outcome → Join the waitlist". Closable, and stays closed once dismissed (localStorage, try/catch).
2. **Nav:** Features · Pricing · Compare · FAQ · Log in · [Start journaling free].
3. **Hero:** eyebrow "FREE · NO CREDIT CARD", then H1, sub, [Start journaling free] and [See how it works] (a secondary outline button that scrolls to the tour).
   - Under the buttons, a mono **proof line** `NEW`: `Free forever · No card · Your AI key, your data · Export anytime · Every edit versioned`. *(27 Sep 2026, checked against the code: shipped as `Free forever · No card · Export anytime · Edit history on every trade`. "Every edit versioned" is false — each trade keeps its newest 50 versions (0023) — and "Your AI key, your data" named a paid-only feature (every AI route is `requirePaidUser`) nobody can buy yet. Alon chose this line.)*
4. **Framed product preview** (the existing coded dashboard), with 2–3 **floating cards** `NEW` overlapping its edges:
   - "⚠ Rule broken: stop moved after entry"
   - "AI review 78/100 · Exit 61"
   - "MAE −2.47% · you sat through the heat"
5. **"Import" strip** `NEW`: "Confirmed working:" then one chip "Interactive Brokers screenshots (stocks)". Below it, smaller text: "Manual entry works for any broker or market." Do NOT say "exports from" or "CSV" — no CSV/XLSX broker import has been tested yet.
6. **How it works:** 3 columns (Screenshot → Trade card → Review), each with its FREE/PAID label. This replaces the carousel.
7. **Tabbed tour** `NEW`, replacing the 3 spotlights and the Find My Edge block.
   - Tabs: Rules & mistakes · MAE/MFE · Find my edge · Import · AI review.
   - Each tab: eyebrow, H3, 3 bullets, a framed real screenshot or coded preview, and a FREE/PAID badge.
   - Keyboard accessible (arrow keys, ARIA tab pattern).
8. **"No made-up numbers" block** `NEW`: "Every number comes from your trades. If we can't compute it, we say so."
   - Show a sample card in its "⚠ Not enough trades" state, using the app's real empty-state wording if one exists.
9. **What's included:** the existing 12 cards, kept. Add the line "Nothing above is a teaser. It's what free actually includes." *(27 Sep 2026: shipped as "Everything marked FREE is in the free plan today. Nothing here is a trial." The spec's line would be false beside the PAID cards in the same grid.)*
10. **How we compare** `NEW`: a table, see Phase 3.
11. **Trust trio** `NEW`: three tiles.
    - "Your AI key, never ours": bring your own key, encrypted, billed to your own provider.
    - "Export everything": CSV/XLSX, plus JSON only if the code supports it.
    - "Every edit versioned."
12. **Pricing:** two cards side by side.
    - **Free, $0:** the existing card.
    - **Paid, "Coming soon":** this card **already exists in the codebase**. Find it and reuse it as-is (styling only, if it needs to match the new tokens) — do not write new copy or a new feature list for it. Add the waitlist email field to it if it doesn't already have one. *(27 Sep 2026: this is the paid card in `v2/PricingTeaser.tsx`, the same card as the old UNDER CONSTRUCTION spot. Since 2B it's labelled "Coming soon" and carries the waitlist form.)*
    - Add the line "Free means free. No broker account required."
13. **Founder note** `NEW`: a placeholder section that renders only if `FOUNDER_NOTE` text is supplied (see Facts). No testimonials until real ones exist.
14. **FAQ** `NEW`: 6–8 questions (Phase 2).
15. **Final CTA band:** "Start with your next trade." on the `#0E1A2E` background.
16. **Footer** `NEW` 4 columns:
    - **Product:** Features, Pricing, Paid plan (waitlist), Changelog (only if a page exists).
    - **Compare:** anchor links to the compare table for now.
    - **Resources:** Import help, Contact (mailto the address in Facts).
    - **Legal:** Privacy, Terms, Cookies.
    - Plus Instagram, TikTok and YouTube icons (URLs are in Facts Alon supplies), and © year.

Why this order: promise → proof → how → what → why us → price → doubts (FAQ) → act. Trust sections sit right after the hero, because that's where a skeptical trader decides whether to keep reading.

---

## Facts Alon supplies

Fill these in before the phase that needs them. If one is still `TODO`, the agent must not invent a value. It should either hide that element or stop and ask.

```yaml
tested_import_sources: []     # NONE confirmed for CSV/XLSX broker import — see note below, screenshot import is the only tested import path
screenshot_import_tested_for: Interactive Brokers   # only broker screenshot actually confirmed working, and only for stocks
markets_supported: [stocks, crypto]   # journaling works for both; screenshot/OCR import is confirmed for stocks only, not confirmed for crypto
export_formats: [XLSX]        # CSV not confirmed — do not claim it
instagram_url: https://www.instagram.com/tradinglenz/
tiktok_url: https://www.tiktok.com/@trading_lenz
youtube_url: https://www.youtube.com/@TradingLenz
contact: TradingLenzSupport@proton.me   # a real, live address — the sign-in page already links it for support and for account deletion. Phase 2C's footer SHOULD carry a Contact link
founder_note: null            # skipped — no founder note section
paid_plan_card: EXISTING      # it's the paid card in src/components/landing/v2/PricingTeaser.tsx. There was never a separate "Coming soon" card: that card wore the "Under construction" badge, and Phase 2B relabelled it "Coming soon" (issue 9). Corrected 27 Sep 2026 from the code.
```

**Important correction on imports:** the spec below originally assumed brokers had CSV/XLSX exports tested. That is NOT true yet — only **screenshot import of Interactive Brokers stock trades** has actually been tested and confirmed working. No broker's CSV/XLSX export has been verified. Any "Imports from" copy must say screenshot import, not CSV/XLSX export, and must name only Interactive Brokers, only for stocks.

### Competitor facts for the compare table

This is what each site stated on 23 Sep 2026. **Alon re-checks every one before merge.** Each cell links to the source page.

| | Trading Lens | TradeZella | Tradervue | TraderWaves |
|---|---|---|---|---|
| Free plan | Yes, no expiry, no card | No free plan on /pricing | Free tier (trial terms) | "Free forever" |
| Entry paid price | Not on sale yet | $26/mo yearly · $35 monthly | $29.95/mo | $19.99/mo |
| AI trade review | Graded on execution, not outcome (bring your own key) | Paid (from $35/mo) | — | Paid (Wave AI, Pro) |
| MAE/MFE on free plan | No — paid plan only (not on sale yet) | verify | verify (Gold has "exit analysis") | verify |
| Bring your own AI key | Yes (6 providers) | verify | — (no AI) | No (Wave AI is Pro-only) |

Only include rows backed by a link. A dash means "not offered or not found". Say that in a footnote.

**Corrected 26 Sep 2026, from the codebase, not from the audit.** The Trading Lens "MAE/MFE on free plan" cell said "Yes". The code says otherwise: `src/components/landing/FeatureGrid.tsx` marks MAE / MFE `paid: true`, and `/analytics` only fetches the excursion report for paid accounts (`isPaidUser`). The Trading Lens column is ours to state, so it is checked against the code like any other claim on the site — re-check every cell in it before 3D ships, not only the competitors'.

---

## Phases

Each phase or sub-phase is **its own branch and PR**. Start each one in plan mode: read this spec, find the files, propose a plan with file paths, and wait for approval.

### Every PR must

- Pass the repo's typecheck, lint, vitest and `next build` scripts (see `package.json`).
- Add vitest tests for any new pure logic: formatter, waitlist validation, toast timing.
- Include a PR checklist of what to verify on the Netlify deploy preview at **630px, 850px and 1280px**, in dark and light theme. If a browser tool is available in the session, capture those screenshots yourself.
- Change nothing outside its scope. List anything else you noticed under "Follow-ups" in the PR description instead.

### Phase 1: bug fixes (P1)

- **1A: Money formatter:** issue 3.
- **1B: Motion:** issues 7, 8, 4 and 11. These likely share one reveal/counter component, so find it first.
- **1C: App chrome:** issues 1, 2 and 6.
- **1D: Metadata:** issue 10.

Out of scope: any new homepage sections.

### Phase 2: tokens and homepage trust sections

- **2A: Tokens:** add the tokens above. Apply heading sizes and weights, button shape, and alternating section bands to the **existing** sections. No layout changes.
- **2B: Waitlist:**
  - **Migration:** a new migration creating `waitlist` (`id uuid pk default gen_random_uuid()`, `email text not null`, `source text`, `created_at timestamptz default now()`, unique index on `lower(email)`). Turn RLS on with **no policies**, so the client can't read or write it directly.
  - **API route:** `POST /api/waitlist`:
    - validates the email, and rejects over 254 characters
    - honeypot field: if it's filled, return 200 and store nothing
    - uses the existing rate limiter
    - inserts with the service role
    - a duplicate email returns the same 200 success, so it doesn't reveal who is on the list
  - **Form UI:** used in the announcement bar link target, the existing paid-plan "Coming soon" card, and the old UNDER CONSTRUCTION spot (issue 9). States: idle, submitting, success ("You're on the list."), error ("Couldn't save that. Try again.").
  - **Spam protection:** first, search the codebase for an existing Cloudflare Turnstile integration (it's used on at least one signup form already). If found, reuse that same integration for this form. If Turnstile can't be reused here for any reason, fall back to a hidden honeypot field as described below, and say why in the PR. *(Done 27 Sep 2026: Turnstile is on sign-in, sign-up and forgot-password, but its tokens are verified by Supabase with a secret held only in the Supabase dashboard, so this app can't check one without a new `TURNSTILE_SECRET_KEY` kept in sync between local and Netlify. Alon chose the honeypot fallback plus a 5-per-hour-per-IP limit.)*
  - Out of scope: sending emails or an admin view (Alon exports from Supabase). Also out of scope: making the paid plan actually purchasable — that happens later, once a payment method is set up (see backlog).
- **2C: Homepage sections:**
  - **Announcement bar:** `#1` in the target order.
  - **Proof line:** part of the hero.
  - **"Imports from" strip:** needs `tested_import_sources`, otherwise hide it. *(27 Sep 2026: superseded by the "Important correction on imports" and target order #5, which define the strip as Interactive Brokers screenshots, stocks only. Shipped that way.)*
  - **FAQ:** built from `<details>`/`<summary>` elements, plus `FAQPage` JSON-LD. Questions:
    1. Is it really free? What's the catch?
    2. What happens when the paid plan launches?
    3. Which brokers can I import from? (Answer only from `screenshot_import_tested_for` — currently just Interactive Brokers screenshots, stocks only — plus "manual entry works for any broker or market.")
    4. How does the screenshot reader work?
    5. Is my data used to train AI? Where does my AI key go?
    6. Can I export my data? (Answer only from `export_formats` — currently XLSX only, do not mention CSV.)
    7. Which markets does it support? (Answer only from `markets_supported` — stocks and crypto.)
    8. Is there a mobile app?

    Draft answers only from facts in this file or verifiable in the code. Mark every answer for Alon's review in the PR description.
  - **Full footer.** *(27 Sep 2026: shipped with real links only — Product, Help, Legal. No Compare column until the 3D table exists; no Import help or Changelog, because those pages don't exist.)*

### Phase 3: homepage restructure (P2)

- **3A:** reorder the page to the target order, replace the carousel with 3 columns, add the floating cards. *(Shipped 27 Sep 2026, per the layout sketch Alon approved: How it works straight after the hero -- first built as 3 columns, then put back to the rotating card stack at Alon's request the same day (it keeps the new heading and the #how-it-works anchor); Find My Edge moved down with the feature stories until 3B; the hero's second button is "See how it works"; floating cards on the preview from lg up, overhanging 12px at lg and 28px from xl so they neither clip at the screen edge nor reach the text at 1024–1150px. "Three jobs a plain record leaves to you" isn't in the target order and is kept until 3B decides. The preview caption reads "Sample figures": the preview's numbers are hand-drawn illustration older than the demo account; only the floating cards' figures are the demo account's.)*
- **3B:** tabbed tour, which replaces the spotlights and Find My Edge. *(Shipped 27 Sep 2026, wording and badges approved by Alon: five tabs, FREE / PAID / PAID / FREE / PAID, each badge checked against the app's real gates and held there by tour-content.test.ts. The paid tabs add "Part of the paid plan, coming soon. Join the waitlist", because "Paid" alone reads as buyable today. The tour carries id="features", so the nav's Features link lands on it. "Three jobs a plain record leaves to you" was removed: every point it made is a tour tab now, and its MAE/MFE point read as free when it's paid-only. The feature stories, Find My Edge plate and Three jobs were deleted, not hidden.)*
- **3C:** "No made-up numbers" block, trust trio, two-card pricing, founder note (hidden if not supplied). *(Shipped 27 Sep 2026, wording approved by Alon. "No made-up numbers" after the tour, its sample card quoting the free Mistakes panel's withheld state with the app's own minimum (MIN_COMPARISON_SAMPLE). Trust trio before pricing, two titles corrected against the code: "Export every trade" (the export is trades only, XLSX the one confirmed format) and "Edit history on every trade" (newest 50 versions); "Your AI key, never ours" is badged Paid · coming soon. Pricing: two peers, Free left at ~40% and Paid right at ~60%, copy unchanged, plus "Free means free. No broker account required." No founder note: `founder_note` is null, so nothing was built for it.)*
- **3D:** compare table. It's blocked until Alon confirms the competitor facts.

### Phase 4: app (P2)

- **4A: Trade side panel.** Clicking a row in the trade list opens a right-side panel with the trade detail.
  - **Keys:** ← → move to the previous or next trade in the current filtered and sorted order. Esc closes the panel.
  - **Full page:** "Open full page" goes to the existing detail route. Direct links and refresh must still open the full page.
  - **Approach:** the suggested one is App Router parallel + intercepting routes (`@panel` slot with `(.)` interception). Final approach is your call.
- **4B: Summary strip** above the trade table: Net P/L, win rate, profit factor, average hold, trade count, expectancy. *(Shipped 28 Sep 2026: closed trades only, investment mode excluded -- getAnalyticsSummary's definition, so unfiltered the strip matches /analytics (checked on the demo account). The engine's own minimums, 5 closed trades, and 5 with an R multiple for expectancy (Alon's choice). Average hold was added to the stats engine (summariseSegment) so every figure comes from it. The list and the strip share one filter function.)*
  - It updates with the active filters and is computed with the existing stats engine.
  - When the filtered set is too small for a metric, show "—" with a tooltip. Never 0.
- **4C: Chart fix:** issue 5. *(Shipped 28 Sep 2026. The chart opens on the holding period in a bar size picked from the hold and its age (Alon's choice): 5-minute for a day trade in the last 60 days, hourly up to 20 days within two years, daily otherwise, with pre/after-market bars for intraday. ▲/▼ on the entry and exit bars, flipped for shorts; the price scale always includes the trade's own levels. Checked against the code first: the demo account's prices are synthetic (a random walk from fixed base prices), so its 2 Sep 2026 TSLA trade sits at ~$234 while real TSLA traded ~$350 that day. When a trade's price isn't on its market bar the chart says so and scales to the trade's own levels -- which is how "clearly separated" is met on that trade -- rather than drawing lines that look like they belong to bars they don't.)*
- **4D: Demo workspace:** do this last and plan it separately.
  - New accounts with zero trades see clearly labeled, read-only seeded demo data and a banner: "Import your first trade → From screenshot / CSV / Manual".
  - Demo data must never mix into real stats and must disappear once the first real trade exists.

### Follow-ups: noticed along the way, not yet scheduled

Found while doing a phase and deliberately left out of its scope. Each needs Alon's go-ahead before it's picked up.

- **Unify the two average-hold calculations** *(from 4B, 28 Sep 2026; Alon asked for this to be tracked).* The stats engine (`summariseSegment` in `src/lib/segments/engine.ts`) now computes `avgHoldingDays`, and `getAnalyticsSummary` in `src/lib/analytics/queries.ts` still computes its own inline. They use the same rule today (both dates present, hold of zero or more), but nothing keeps them in step. Fix: have `getAnalyticsSummary` take the figure from the engine, or both from one helper.
- **The paid-tour offer card covers the bottom of the trade side panel** *(from 4A).* It is dismissible and shows at most once a session, but it sits over the panel's notes until then.
- **Rebuild the demo account's trades from real historical prices** *(from 4C, 28 Sep 2026).* `scripts/seed-demo-account.mjs` invents prices with a random walk from fixed base prices (TSLA from $244), so no demo trade lines up with real market data: since 4C every demo chart shows the "outside the range" note, and the ▲/▼ markers sit on real bars off-screen. Seeding entries and exits from Yahoo's actual bars would fix both. Probably belongs with 4D (demo workspace). Low exposure meanwhile: only Alon uses the demo login.
- **The chart's breakeven line ignores a hand-typed commission** *(found checking exit against breakeven, 28 Sep 2026).* `TradeCard` computes it with `computeBreakevenPrice(matchCommissionRule(...), trade)` (`src/lib/commissions/calculate.ts`), from the commission *rule* even when `commission_manual` is set, so a trade whose fee was typed in shows a breakeven for the rule's fee (or none, with no rule) rather than the one it paid. Win/loss is unaffected: it comes from `dollar_pl`, which is net of the stored commission. Needs a decision on what a typed commission covers (entry side only while open, both sides once closed) before the line can use it.
- **DashboardPage logs a React "missing key" warning** in dev *(noticed during 4A)*, from a child passed into a `motion.div`. Pre-existing.

### Backlog: P3, don't start without being asked

- Real testimonials once users supply them.
- One import-guide page per tested broker (SEO) — blocked until more brokers are tested beyond IBKR screenshots.
- Shareable trade card image (R-multiple, rule score, chart).
- Compare report (period vs period, tag vs tag) and custom dashboard layouts.
- Installable PWA.
- **Activate the paid plan.** Once Alon has a payment method configured (e.g. Stripe), flip the existing "Coming soon" pricing card to a live, purchasable state (real price, checkout flow, billing webhook). This is a separate, larger task — don't start it as part of any phase above. Alon will open a new session for it specifically when ready.
