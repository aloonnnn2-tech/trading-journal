# OCR Evaluation Report

Generated: 2026-10-11T16:33:12.897Z

- **Images:** 18
- **Overall accuracy:** 97.5%
- **Precision:** 97.5%
- **Recall:** 97.5%
- **False positives:** 2
- **Avg processing time:** 1073 ms
- **Auto-fill threshold:** 0.55

## Per-field accuracy

"Filled" counts what the form fills in by itself; the rest of the correct
reads are suggestions the user accepts. "Wrong, filled" is the number that
must stay at zero: a wrong value typed into the form for the user.

| Field | Accuracy | Correct | Filled | Wrong | Wrong, filled | Missing | Avg conf (correct) | Avg conf (wrong) |
|---|---|---|---|---|---|---|---|---|
| ticker | 100.0% | 18 | 12 | 0 | 0 | 0 | 0.75 | 0 |
| direction | 100.0% | 16 | 16 | 0 | 0 | 0 | 0.847 | 0 |
| entry_price | 92.9% | 13 | 11 | 1 | 0 | 0 | 0.898 | 0.55 |
| stop_loss | 100.0% | 12 | 12 | 0 | 0 | 0 | 0.922 | 0 |
| take_profit | 100.0% | 10 | 10 | 0 | 0 | 0 | 0.924 | 0 |
| shares | 100.0% | 17 | 13 | 0 | 0 | 0 | 0.867 | 0 |
| position_size | 100.0% | 7 | 7 | 0 | 0 | 0 | 0.979 | 0 |
| risk_amount | 100.0% | 1 | 1 | 0 | 0 | 0 | 0.964 | 0 |
| order_type | 87.5% | 7 | 7 | 0 | 0 | 1 | 0.8 | 0 |
| time_in_force | 83.3% | 5 | 5 | 0 | 0 | 1 | 0.853 | 0 |
| average_price | 100.0% | 3 | 0 | 0 | 0 | 0 | 0.93 | 0 |
| current_price | 100.0% | 3 | 0 | 0 | 0 | 0 | 0.962 | 0 |
| status | 100.0% | 2 | 2 | 0 | 0 | 0 | 0.7 | 0 |
| dollar_amount | 100.0% | 2 | 2 | 0 | 0 | 0 | 0.938 | 0 |
| limit_price | 100.0% | 1 | 1 | 0 | 0 | 0 | 0.958 | 0 |
| entry_date | 100.0% | 1 | 1 | 0 | 0 | 0 | 0.998 | 0 |

## Per broker

Set `"broker"` in each fixture's .expected.json (see fixtures/BROKERS.md).

| Broker | Images | Correct | Accuracy | False+ |
|---|---|---|---|---|
| (not labelled) | 17 | 109/112 | 97.3% | 2 |
| TradingView | 1 | 9/9 | 100.0% | 0 |

## Per-image

| Fixture | Correct | False+ | ms | Engine |
|---|---|---|---|---|
| crypto/crypto-position.png | 6/6 | 0 | 1451 | paddleocr |
| forex/mt5-buy.png | 6/6 | 0 | 494 | paddleocr |
| futures/futures-style-short.png | 6/6 | 0 | 537 | paddleocr |
| new-broker/order-khc-stop.jpg | 9/9 | 0 | 886 | paddleocr |
| new-broker/order-schw-limit.jpg | 8/8 | 0 | 812 | paddleocr |
| new-broker/order-txt-stop.jpg | 8/8 | 0 | 779 | paddleocr |
| new-broker/order-usb-stop.jpg | 8/9 | 0 | 770 | paddleocr |
| options/position-qqq-put.png | 6/6 | 0 | 833 | paddleocr |
| options/webull-options-position.png | 6/6 | 0 | 946 | paddleocr |
| options/webull-options-tpsl.png | 7/8 | 0 | 745 | paddleocr |
| stocks/dark-open-position.png | 6/6 | 0 | 439 | paddleocr |
| stocks/light-order-ticket.png | 7/7 | 0 | 546 | paddleocr |
| stocks/STEP-4-trade-on-tradingview.webp | 4/4 | 0 | 2245 | paddleocr |
| stocks/stop-order-bare-price.png | 5/5 | 1 | 549 | paddleocr |
| stocks/Trading_overview_stocks_(Dark_theme).png | 4/5 | 1 | 4060 | paddleocr |
| stocks/Trading_View_Gallery-7-7.png | 5/5 | 0 | 1965 | paddleocr |
| stocks/tv-veev-stop-limit-dark.png | 9/9 | 0 | 718 | paddleocr |
| stocks/webull-style-buy.png | 8/8 | 0 | 531 | paddleocr |
