# OCR Evaluation Report

Generated: 2026-07-05T23:11:56.594Z

- **Images:** 17
- **Overall accuracy:** 98.0%
- **Precision:** 95.1%
- **Recall:** 98.0%
- **False positives:** 3
- **Avg processing time:** 1256 ms
- **Auto-fill threshold:** 0.55

## Per-field accuracy

| Field | Accuracy | Correct | Wrong | Missing | Avg conf (correct) | Avg conf (wrong) |
|---|---|---|---|---|---|---|
| ticker | 94.1% | 16 | 1 | 0 | 0.9 | 0.9 |
| direction | 100.0% | 15 | 0 | 0 | 0.85 | 0 |
| entry_price | 92.3% | 12 | 1 | 0 | 0.893 | 0.55 |
| stop_loss | 100.0% | 11 | 0 | 0 | 0.957 | 0 |
| take_profit | 100.0% | 9 | 0 | 0 | 0.965 | 0 |
| shares | 100.0% | 16 | 0 | 0 | 0.86 | 0 |
| position_size | 100.0% | 7 | 0 | 0 | 0.979 | 0 |
| risk_amount | 100.0% | 1 | 0 | 0 | 0.964 | 0 |
| average_price | 100.0% | 3 | 0 | 0 | 0.93 | 0 |
| current_price | 100.0% | 3 | 0 | 0 | 0.962 | 0 |
| status | 100.0% | 2 | 0 | 0 | 0.7 | 0 |
| dollar_amount | 100.0% | 2 | 0 | 0 | 0.938 | 0 |
| entry_date | 100.0% | 1 | 0 | 0 | 0.998 | 0 |

## Per-image

| Fixture | Correct | False+ | ms | Engine |
|---|---|---|---|---|
| crypto/crypto-position.png | 6/6 | 0 | 1865 | paddleocr |
| forex/mt5-buy.png | 6/6 | 0 | 510 | paddleocr |
| futures/futures-style-short.png | 6/6 | 0 | 603 | paddleocr |
| new-broker/order-khc-stop.jpg | 7/7 | 1 | 1003 | paddleocr |
| new-broker/order-schw-limit.jpg | 6/6 | 0 | 902 | paddleocr |
| new-broker/order-txt-stop.jpg | 6/6 | 1 | 904 | paddleocr |
| new-broker/order-usb-stop.jpg | 7/7 | 0 | 906 | paddleocr |
| options/position-qqq-put.png | 6/6 | 0 | 874 | paddleocr |
| options/webull-options-position.png | 6/6 | 0 | 899 | paddleocr |
| options/webull-options-tpsl.png | 7/7 | 0 | 865 | paddleocr |
| stocks/dark-open-position.png | 6/6 | 0 | 554 | paddleocr |
| stocks/light-order-ticket.png | 7/7 | 0 | 623 | paddleocr |
| stocks/STEP-4-trade-on-tradingview.webp | 2/3 | 0 | 2584 | paddleocr |
| stocks/stop-order-bare-price.png | 5/5 | 0 | 597 | paddleocr |
| stocks/Trading_overview_stocks_(Dark_theme).png | 3/4 | 1 | 4686 | paddleocr |
| stocks/Trading_View_Gallery-7-7.png | 4/4 | 0 | 2357 | paddleocr |
| stocks/webull-style-buy.png | 8/8 | 0 | 625 | paddleocr |
