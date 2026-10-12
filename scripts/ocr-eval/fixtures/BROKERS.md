# Screenshot import: brokers to collect and how

The accuracy numbers (`npm run ocr:eval`, per broker) only mean something
when the screenshots are **real**. None may be invented (hardening brief,
Problem 2).

## The 10 brokers to cover first

These are widely used retail trading platforms, chosen so the test set
covers the layouts most traders will actually upload. Popularity varies by
country and year, so this order is a working list, not a measured ranking.

| # | Broker / platform | What it looks like |
|---|---|---|
| 1 | **Interactive Brokers** (TWS, IBKR Mobile, Client Portal) | Already confirmed by Alon for stocks. Its screenshots protect that claim. |
| 2 | **Robinhood** | Phone app order and position screens |
| 3 | **Webull** | Desktop and phone (2 option screenshots already in the set) |
| 4 | **Charles Schwab / thinkorswim** | Order entry, the positions grid |
| 5 | **Fidelity** (Active Trader Pro, app) | Order tickets, the positions table |
| 6 | **E\*TRADE** (Power E\*TRADE) | Order tickets, the portfolio |
| 7 | **eToro** | Open and closed positions |
| 8 | **Trading 212** | Positions and order history |
| 9 | **TradingView** (order panel, with any connected broker) | 3 images already in the set |
| 10 | **A crypto exchange: Binance or Coinbase** | Spot order and trade history |

If you trade forex or CFDs, **MetaTrader 5** is worth adding too (one
synthetic image is in the set today).

## What to send, per broker

At least **5 screenshots** per broker, ideally covering:

1. A **buy that filled** (the confirmation, or the order in history).
2. An **open position** (the positions screen).
3. A **closed trade** (history row or closed position).
4. One order ticket for **each order type you use**: market, limit, stop,
   stop-limit, trailing stop.
5. A **short trade**, if you short on that broker.

**Before sending:** crop or blur account numbers, your name and balances you
don't want stored. Keep the ticker, prices, quantities, order type, side,
time in force and dates visible. Those are what get measured.

## How they become fixtures

Put each image in a folder named after the broker, for example
`fixtures/robinhood/filled-buy.png`. Next to it goes a
`filled-buy.expected.json` holding the values **visible in the image**, plus
the broker name for the per-broker table:

```json
{
  "broker": "Robinhood",
  "note": "Filled market buy, 10 AAPL",
  "core": { "ticker": "AAPL", "direction": "long", "entry_price": 190.12, "shares": 10, "order_type": "market" }
}
```

Claude can draft the expected file from the image, but **you confirm the
values**: the expected file is the truth everything is scored against. Then:

```bash
npm run ocr:record     # records what the OCR reads, for the replay test in npm test
npm run ocr:eval       # per-field, per-broker accuracy -> scripts/ocr-eval/report.md
npm run ocr:eval -- --min=0.95   # fails if accuracy drops or a wrong value would be auto-filled
```

Whenever someone reports a wrong import, add their screenshot (cleaned up as
above) as a fixture, so that mistake can never come back unnoticed.

## Screenshots from other sites (order types)

Real screenshots from brokers' help pages and forums widen coverage, but
they are someone else's images, so they **never go in this public repo**.
They live in `scripts/ocr-eval/web-inbox/`, which git ignores, with:

- `sources.json`: where each one came from;
- `answers.json`: the order type each screen's own text states, or `null`
  when it can't tell (tabs, menus, several different orders).

```bash
npm run ocr:record -- --dir=scripts/ocr-eval/web-inbox   # after adding images
npm run ocr:web                                          # score; fails on any wrong fill
```

As of 2026-10-11: 48 screenshots (TradingView, IBKR TWS / Desktop / Client
Portal / Mobile, Webull, MetaTrader 5, Trading 212, E\*TRADE, Fidelity,
tastytrade, thinkorswim): 27 filled correctly, 0 wrong, 20 correctly left
empty, 1 missed (an MT5 chart label too small to read). The patterns they
taught are pinned in `src/lib/ocr/order-type.test.ts`.
