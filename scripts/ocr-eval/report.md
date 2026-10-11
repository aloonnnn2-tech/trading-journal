# OCR Evaluation Report

Generated: 2026-10-11T15:22:48.196Z

- **Images:** 17
- **Overall accuracy:** 97.3%
- **Precision:** 97.3%
- **Recall:** 97.3%
- **False positives:** 2
- **Avg processing time:** 1120 ms
- **Auto-fill threshold:** 0.55

## Per-field accuracy

"Filled" counts what the form fills in by itself; the rest of the correct
reads are suggestions the user accepts. "Wrong, filled" is the number that
must stay at zero: a wrong value typed into the form for the user.

| Field | Accuracy | Correct | Filled | Wrong | Wrong, filled | Missing | Avg conf (correct) | Avg conf (wrong) |
|---|---|---|---|---|---|---|---|---|
| ticker | 100.0% | 17 | 17 | 0 | 0 | 0 | 0.9 | 0 |
| direction | 100.0% | 15 | 15 | 0 | 0 | 0 | 0.847 | 0 |
| entry_price | 92.3% | 12 | 10 | 1 | 0 | 0 | 0.893 | 0.55 |
| stop_loss | 100.0% | 11 | 11 | 0 | 0 | 0 | 0.921 | 0 |
| take_profit | 100.0% | 9 | 9 | 0 | 0 | 0 | 0.921 | 0 |
| shares | 100.0% | 16 | 12 | 0 | 0 | 0 | 0.86 | 0 |
| position_size | 100.0% | 7 | 7 | 0 | 0 | 0 | 0.979 | 0 |
| risk_amount | 100.0% | 1 | 1 | 0 | 0 | 0 | 0.964 | 0 |
| order_type | 85.7% | 6 | 6 | 0 | 0 | 1 | 0.8 | 0 |
| time_in_force | 80.0% | 4 | 4 | 0 | 0 | 1 | 0.851 | 0 |
| average_price | 100.0% | 3 | 0 | 0 | 0 | 0 | 0.93 | 0 |
| current_price | 100.0% | 3 | 0 | 0 | 0 | 0 | 0.962 | 0 |
| status | 100.0% | 2 | 2 | 0 | 0 | 0 | 0.7 | 0 |
| dollar_amount | 100.0% | 2 | 2 | 0 | 0 | 0 | 0.938 | 0 |
| entry_date | 100.0% | 1 | 1 | 0 | 0 | 0 | 0.998 | 0 |

## Per broker

Set `"broker"` in each fixture's .expected.json (see fixtures/BROKERS.md).

| Broker | Images | Correct | Accuracy | False+ |
|---|---|---|---|---|
| (not labelled) | 17 | 109/112 | 97.3% | 2 |

## Per-image

| Fixture | Correct | False+ | ms | Engine |
|---|---|---|---|---|
| crypto/crypto-position.png | 6/6 | 0 | 1323 | paddleocr |
| forex/mt5-buy.png | 6/6 | 0 | 481 | paddleocr |
| futures/futures-style-short.png | 6/6 | 0 | 555 | paddleocr |
| new-broker/order-khc-stop.jpg | 9/9 | 0 | 931 | paddleocr |
| new-broker/order-schw-limit.jpg | 8/8 | 0 | 824 | paddleocr |
| new-broker/order-txt-stop.jpg | 8/8 | 0 | 934 | paddleocr |
| new-broker/order-usb-stop.jpg | 8/9 | 0 | 798 | paddleocr |
| options/position-qqq-put.png | 6/6 | 0 | 786 | paddleocr |
| options/webull-options-position.png | 6/6 | 0 | 826 | paddleocr |
| options/webull-options-tpsl.png | 7/8 | 0 | 738 | paddleocr |
| stocks/dark-open-position.png | 6/6 | 0 | 463 | paddleocr |
| stocks/light-order-ticket.png | 7/7 | 0 | 588 | paddleocr |
| stocks/STEP-4-trade-on-tradingview.webp | 4/4 | 0 | 2270 | paddleocr |
| stocks/stop-order-bare-price.png | 5/5 | 1 | 514 | paddleocr |
| stocks/Trading_overview_stocks_(Dark_theme).png | 4/5 | 1 | 4242 | paddleocr |
| stocks/Trading_View_Gallery-7-7.png | 5/5 | 0 | 2171 | paddleocr |
| stocks/webull-style-buy.png | 8/8 | 0 | 592 | paddleocr |
