# Investment-mode parity audit (2026-07-28)

Task 4 of the free-tier improvements briefing (`D:\md files\md23.md`). Searched
the codebase for every place that reads/assumes standard-mode fields
(`entry_price`, `exit_price`, `stop_loss`, `take_profit`, position-size fields,
`direction`) without checking `isInvestment`/`mode` first. `isInvestment` is
computed in exactly one canonical way across the app: `trade.mode ===
"investment"` (`src/lib/trades/types.ts`'s `EntityType`).

## Fixed

| Location | Issue | Fix |
|---|---|---|
| `src/lib/analytics/queries.ts` (`getAnalyticsSummary`) | Investment trades' `dollar_pl` is always null (no entry/exit-price data) but were included in the closed-trade set — silently counted as an automatic non-win, inflating the win-rate denominator; also fed a phantom "unknown" direction bucket and 0-P/L points into the equity curve/drawdown. | Added `.neq("mode", "investment")` to the base query. |
| `src/lib/ask/queries.ts` (`getAllAnswers`) | Same root cause — additionally, the loss-streak logic (`won = dollar_pl > 0`) could count an investment close as a "loss" toward a streak it never experienced. | Same `.neq("mode", "investment")` fix. |
| `src/lib/insights/queries.ts` (`getInsights`) | Same root cause, feeding the by-day/by-tag/by-emotion pattern detection. | Same `.neq("mode", "investment")` fix. |
| `src/lib/dashboard/queries.ts` (`getWinRate`) | Same root cause — the dashboard's headline win-rate stat. | Same `.neq("mode", "investment")` fix. |
| `src/lib/dashboard/queries.ts` (`getBestWorstSetup`) | Investment closes counted toward a strategy tag's trade total while contributing 0 P&L and never winning. | Same `.neq("mode", "investment")` fix. |
| `supabase/migrations/0020_dashboard_stats_rpc.sql` (`win_stats`, `setup_stats` CTEs) | The new dashboard-stats RPC (built in task 1) reproduces the same two queries above in SQL. | Added `mode <> 'investment'` to both CTEs so the RPC matches the now-fixed JS instead of the old bug. |
| CSV/XLSX import (`import-wizard.tsx`, `trades/import/page.tsx`, `api/trades/import/route.ts`) | The import wizard never exposed a "Mode" column mapping or investment-mode custom fields, and the API route only ever fetched trade-mode field definitions — every CSV/XLSX import silently became a trade-mode row regardless of source data, even though `buildRowFromMapping`/`import.ts` already fully supported `mode` as a mappable enum core field. | Added "Mode" to the wizard's core-field dropdown, fetch + expose investment field definitions alongside trade ones (mirroring `export/route.ts`'s existing "fetch both" pattern) in both the page and the API route. Verified live: imported a CSV with a `Mode=investment` column and an `Average Cost` value, confirmed the resulting trade has `mode: "investment"`, shows the "Investment details" tab (not "Entry information"), and the custom field round-tripped correctly. |

## Confirmed fine, no change needed

- **`src/lib/trades/use-auto-execute.ts`** — `isInvestment` is checked first thing in the price-update handler (`if (isInvestment || executingRef.current) return;`), a clean no-op for investment trades. Already correct from the prior session.
- **`src/lib/trades/missing-fields.ts`** — already fixed in a prior session (investment trades only require `ticker`/`entry_date`, not the standard-mode fields hidden by `TradeCard.tsx`'s `{!isInvestment && ...}`). Confirmed still correct, and reused as-is by this session's new streak feature (task 3).
- **`src/components/trade-card/TradeCard.tsx` / `PriceChart.tsx`** — every standard-mode field render is already gated on `isInvestment`, and `PriceChart` receives already-nulled values for investment trades from its one caller.
- **`src/lib/dashboard/queries.ts`: `getTodayPL`, `getPerformanceSeries`, `getMonthlyPL`** — sum `dollar_pl ?? 0` with no mode filter, but since investment `dollar_pl` is always null (contributes 0), this is numerically harmless even though technically unguarded. Left as-is rather than adding a no-op filter.
- **Export (`export.ts`, `export-import-fields.ts`, `api/trades/export/route.ts`)** — by design per an existing code comment: core columns cover both entity types intentionally, and both trade and investment field definitions are already fetched for CSV/XLSX flattening. Every investment row also emits blank standard-mode columns alongside its real ones — matches the documented intent, not a bug.
- **JSON re-import (`import-json/route.ts`)** — already correctly reads `core.mode` and preserves it; this was the reference pattern the CSV/XLSX fix above was modeled on.

## Follow-up resolved (2026-07-28, same day)

- **`src/lib/account/queries.ts` (`getAccountBalance`, `costOf`)** — was flagged (not fixed) in the original pass of this audit: `costOf` returned `0` for every open investment position since they have no `position_size`/`entry_price`/`shares`, so `committedCash`/`availableCash` never reflected capital tied up in investments.
  - **Decision:** yes, investment cost basis should reduce available cash the same way a trade's position size does.
  - **Fix:** new `investmentCostOf()` reads the seeded default custom fields `average_cost` × `total_shares` (per `supabase/migrations/0002_seed_default_fields.sql`) for `mode === "investment"` open positions, falling back to `0` if either is missing/non-numeric (same silent-fallback behavior `costOf` already has). Mirrored in `supabase/migrations/0021_dashboard_stats_investment_committed_cash.sql` (the dashboard_stats RPC's `account_stats` CTE), using a regex guard instead of a bare cast so a malformed custom-field value degrades that one position to $0 instead of erroring the whole RPC call.
  - **Verified live:** inserted a throwaway open investment trade with `average_cost: 50, total_shares: 20`, confirmed `committedCash` moved by exactly +$1000, reverted cleanly after deleting it.

## Verification

- Live on the demo account: created one throwaway investment-mode trade with an
  extreme `dollar_pl` (-99999, `status: closed`) via a direct insert, confirmed
  the dashboard/win-rate query's `closedTotal`/`wins` counts were byte-for-byte
  unchanged before/after (36 / 17, both snapshots identical) — proving the mode
  filter genuinely excludes it rather than coincidentally not mattering.
- Imported a CSV with a `Mode=investment` column + an `Average Cost` custom
  field mapping, confirmed the resulting trade round-tripped both correctly,
  then deleted the throwaway trade.
- `tsc --noEmit`, `eslint src` (11 pre-existing warnings, 0 new), `next build`
  (all 41 routes) all clean.
