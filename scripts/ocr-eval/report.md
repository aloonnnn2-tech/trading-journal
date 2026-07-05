# OCR Evaluation Report

Generated: 2026-07-04T16:49:01.529Z

- **Images:** 12
- **Overall accuracy:** 91.2%
- **Precision:** 93.9%
- **Recall:** 91.2%
- **False positives:** 1
- **Avg processing time:** 1139 ms
- **Auto-fill threshold:** 0.55

## Per-field accuracy

| Field | Accuracy | Correct | Wrong | Missing | Avg conf (correct) | Avg conf (wrong) |
|---|---|---|---|---|---|---|
| ticker | 83.3% | 10 | 2 | 0 | 0.9 | 0.9 |
| direction | 90.0% | 9 | 0 | 1 | 0.85 | 0 |
| entry_price | 88.9% | 8 | 1 | 0 | 0.876 | 0.55 |
| stop_loss | 100.0% | 7 | 0 | 0 | 0.979 | 0 |
| take_profit | 100.0% | 7 | 0 | 0 | 0.983 | 0 |
| shares | 81.8% | 9 | 0 | 2 | 0.899 | 0 |
| status | 100.0% | 2 | 0 | 0 | 0.7 | 0 |
| position_size | 100.0% | 3 | 0 | 0 | 0.98 | 0 |
| dollar_amount | 100.0% | 2 | 0 | 0 | 0.938 | 0 |
| average_price | 100.0% | 2 | 0 | 0 | 0.938 | 0 |
| current_price | 100.0% | 2 | 0 | 0 | 0.974 | 0 |
| entry_date | 100.0% | 1 | 0 | 0 | 0.998 | 0 |

## Per-image

| Fixture | Correct | False+ | ms | Engine |
|---|---|---|---|---|
| crypto/crypto-position.png | 6/6 | 0 | 1415 | paddleocr |
| forex/mt5-buy.png | 6/6 | 0 | 402 | paddleocr |
| futures/futures-style-short.png | 4/6 | 0 | 461 | paddleocr |
| options/webull-options-position.png | 6/6 | 0 | 762 | paddleocr |
| options/webull-options-tpsl.png | 7/7 | 0 | 749 | paddleocr |
| stocks/dark-open-position.png | 6/6 | 0 | 425 | paddleocr |
| stocks/light-order-ticket.png | 7/7 | 0 | 501 | paddleocr |
| stocks/STEP-4-trade-on-tradingview.webp | 2/3 | 0 | 2008 | paddleocr |
| stocks/stop-order-bare-price.png | 5/5 | 0 | 454 | paddleocr |
| stocks/Trading_overview_stocks_(Dark_theme).png | 2/4 | 1 | 4063 | paddleocr |
| stocks/Trading_View_Gallery-7-7.png | 3/4 | 0 | 1897 | paddleocr |
| stocks/webull-style-buy.png | 8/8 | 0 | 525 | paddleocr |
