# OCR evaluation harness

Offline regression + accuracy testing for the screenshot auto-fill pipeline
(`src/lib/ocr`). Runs the exact `runOcrPipeline` the `/api/ocr/parse` route uses,
so a passing suite reflects real behavior.

## Commands

```bash
npm run ocr:fixtures   # (re)generate the synthetic seed fixtures
npm run ocr:eval       # run the pipeline over every fixture, write a report
npx tsx scripts/ocr-eval/debug.ts stocks/light-order-ticket.png   # dump raw OCR + parse for one image
```

`ocr:eval` writes `report.md` and `report.json` here, with per-field accuracy,
overall accuracy, precision/recall, false positives, confidence calibration, and
average processing time.

## Adding real fixtures (grow toward the 100/500/1000 targets)

Drop image + ground-truth pairs anywhere under `fixtures/<broker-or-category>/`:

```
fixtures/webull/dark-position.png
fixtures/webull/dark-position.expected.json
```

The `.expected.json` lists only the fields you expect to be extracted:

```json
{
  "core": {
    "ticker": "AAPL",
    "direction": "long",
    "entry_price": 150.25,
    "stop_loss": 147.8,
    "current_price": 149.1
  }
}
```

- Keys are field names (core columns *or* extras like `current_price` / `pnl_amount`).
- Numbers are matched within 0.5%; strings are compared case-insensitively.
- Omit fields that aren't in the screenshot — the harness won't penalize their absence.
  Detecting a core-column field not in ground truth counts as a **false positive**
  only if its confidence is at/above `AUTOFILL_CONFIDENCE` — i.e. it would actually
  land in the user's trade. A lower-confidence field is a suggestion the UI shows
  for the user to opt into (per spec: mark confidence, ask the user to confirm)
  and isn't penalized, since it never silently corrupts data.

The synthetic seed fixtures (`generate.ts`) are committed as a smoke test; real
broker screenshots are the meaningful signal.

## OCR engine variant

`OCR_MODEL_VARIANT=server npm run ocr:eval` runs the suite against the larger
PP-OCRv4 "server" ONNX models (if present at `models/paddleocr-server/`) instead
of the bundled mobile ones — see `src/lib/ocr/engines/paddle.ts` for how to fetch
them. **Measured result: 15-70x slower per image for no net accuracy gain** on
CPU-only `onnxruntime-node` (up to 157s on a large chart screenshot, well past
the `/api/ocr/parse` route's own 60s timeout). Left in as an opt-in escape hatch,
not recommended for this app's real-time use case.
