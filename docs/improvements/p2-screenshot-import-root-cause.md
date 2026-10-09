# Problem 2: screenshot trade import is inaccurate and guesses (root cause)

Written 2026-10-09, before any change. Confirmed in the code and by running
`npm run ocr:eval`.

## What Alon reports

- It only works reliably for Interactive Brokers stock trades.
- It isn't accurate enough, and it mixes up numbers or picks the wrong ones.
- It can't capture the order type (market, limit, stop, ...).

## How it works today

Offline PaddleOCR (`src/lib/ocr/engines/paddle.ts`) reads the text, then
`src/lib/ocr/pipeline.ts` runs these stages:

1. Preprocessing.
2. OCR over several image variants.
3. Broker classification.
4. **Label-based parsing** (`semantic.ts`): a value is taken from the same
   line as a fuzzy-matched label, or next to it.
5. Regex fallbacks when there is no label.
6. A second pass over the cropped panel.
7. Validation (`validate.ts`).

Each field carries a confidence. The form auto-fills anything at or above
`AUTOFILL_CONFIDENCE = 0.55` and offers lower-confidence values as
"Detected X. Use it?".

## Causes, confirmed

1. **It guesses before reading anything.**
   - `applyDetected` starts from `{ direction: "long", status: "open" }`
     (`src/app/trades/screenshot-trade-button.tsx:133`). The same defaults
     apply when the read fails (`:181`), and `handleCreate` falls back to
     `status || "open"`.
   - Result: a short trade whose direction wasn't read saves as **long**, and
     a filled or closed trade with no visible status saves as **open**.
     Nothing on screen says these were not read.
2. **Low-certainty values auto-fill.**
   - The "@ price" fallback (`semantic.ts:178`) is given confidence 0.55,
     exactly the auto-fill threshold, so a number matched only by
     `qty @ price` notation lands in Entry price as if it were read from a
     label.
   - The other regex fallbacks (0.6–0.7) also auto-fill.
   - That is the "picks the wrong number" path: the regexes take the first
     plausible number near a pattern, with no label to confirm it.
3. **Order type is read but thrown away.**
   - `order_type` is a recognised label (`labels.ts:124`) and is allowed in
     the panel pass (`pipeline.ts:49`).
   - But it isn't in `OCR_CORE_FIELDS` (`types.ts:117`), so it lands in
     "Also read (no field to save)".
   - The trade already has `order_type`, `limit_price` and `time_in_force`
     columns (migration 0039). Nothing maps the text ("LMT", "Stop Limit",
     "MKT") onto them.
4. **The accuracy number measures the wrong thing.**
   - `npm run ocr:eval`: 98.0% overall, ticker 94.1%, entry price 92.3%.
   - But 7 of the 17 images are **synthetic** (`scripts/ocr-eval/generate.ts`),
     and the parser was tuned against this same set.
   - **None of them is from Interactive Brokers**, the one broker the
     landing page calls confirmed.
   - Order type, direction on short trades and status aren't scored at all.
   - So 98% says the parser fits its own examples. It says nothing about
     real screenshots, which is why it can look fine here while failing in
     use.
5. **Some cross-checks exist, but the user never sees them.**
   - `validate.ts` already checks entry × shares ≈ total, R/R ≈ computed,
     and stop/target on the correct side for the direction. It raises or
     lowers confidence and writes notes.
   - The notes reach `result.validation` but the review screen doesn't show
     which check failed. There's also no duplicate check against trades
     already in the journal.
6. **The test set can't show the one confirmed broker.** The landing page
   says screenshot import is "confirmed for Interactive Brokers stock trades".
   That is Alon's own tested fact ("Facts Alon supplies" in
   `docs/design-audit.md`), so it stays. But no IBKR screenshot is in the
   eval, so the eval can neither show nor protect it. *(Corrected 2026-10-10:
   the first version of this note called the claim unsupported. It is
   supported by Alon's testing, just not by the fixtures.)*

7. **"Limit price" and "stop price" were read as the take-profit and the
   stop-loss.** On a limit or stop ENTRY ticket they are the entry, so a buy
   limit's price could land in Take Profit. (`labels.ts` alias lists.)
8. **"Sell" was read as short, and "Filled" as closed.** A bare "Sell" is
   usually a long being closed, and a filled buy OPENS a trade.
9. **Greyed-out placeholders were filled in.** A switched-off take-profit
   box's placeholder (e.g. 26.33 on the KHC ticket) passed the greyed-out
   check, and even when demoted its confidence stayed above the auto-fill bar.

## What this means for the fix

- **Guessing and the wasted order type can be fixed now, in code**:
  - remove the defaults;
  - require the user to fill what wasn't read;
  - map order types;
  - show failed checks.
- **Accuracy can't be fixed honestly without real screenshots.** Real
  broker screenshots, each with its expected values, are the only way to
  measure and then improve it. Per the brief, those must come from Alon.
  None may be invented.

## What Part 1 changed (2026-10-10)

- **No defaults.**
  - Direction and status start empty and are required, so Create stays
    disabled until they're set.
  - An exit price no longer implies Closed.
- **Suggestions are never filled in.** `shouldAutofill()` fills only values
  read beside their own label with confidence. Pattern matches, ambiguous
  words and greyed boxes are offered as "Maybe X? (why). Use it". This
  applies to both the new-trade dialog and the existing-trade scanner.
- **Order prices are resolved by order type** (`src/lib/ocr/resolve.ts`):
  - a stop or limit order's price becomes an entry suggestion;
  - a stop-limit keeps its limit price;
  - a "Take-Profit Order" or "Stop-Loss Order" dialog's prices are the
    target and the stop;
  - stop and target placement settles an ambiguous direction.
- **Order type and time in force are captured** from a labelled value or the
  ticket's own summary line ("10AAPL@278.00LMT"). The summary line also
  corrects a weak ticker read ("SSPY" becomes SPY). Order type is shown in the
  trade list, filterable there, and is a Find My Edge breakdown.
- **Checks are visible.** Failed cross-checks and cancelled orders appear in
  a "Check before saving" box. Hovering a value shows the exact text read. A
  trade that looks like one already in the journal is flagged with a link.
- **Greyed-out detection** also compares how bright the text gets (real
  values reach full contrast, placeholders don't), and a greyed value becomes
  a suggestion.
- **Measured:**

  | | Before | After |
  |---|---|---|
  | Accuracy (incl. order type and time in force, which weren't measured before) | 98.0% | 97.3% |
  | Precision | 95.1% | 97.3% |
  | Ticker | 94.1% | 100% |
  | Wrong values auto-filled | 3+ | 0 |

  `npm run ocr:eval -- --min=0.95` now fails on any wrong auto-fill, and
  `src/lib/ocr/regression.test.ts` replays every fixture in `npm test`.
- **Still open:** real screenshots per broker (`fixtures/BROKERS.md`), and
  a greyed placeholder on light themes. Not done:
  - `stop_price`: in this app's model a stop order's trigger is its
    `entry_price`, so a second column would hold the same number.
  - `import_source` / `import_confidence`: deferred until something reads
    them (Part 2's AI reader may be the first).

## What Part 2 added (2026-10-10): "Read with AI"

- **What it is:** an optional second reader on the review screen, for the
  paid plan, using the user's own key. It needs an OpenAI, Anthropic, Google,
  Mistral or OpenRouter key, because Groq, Cerebras and SambaNova's configured
  models can't see images. The offline reader stays the default and stays on
  screen if the AI call fails.
- **Consent:** its own agreement (`screenshot_v1`), worded to say the image
  itself is sent. The chat's agreement never mentioned images. Checked
  server-side before anything leaves (`preflightProviderCall`).
- **The image:** checked by its bytes, re-encoded (metadata stripped, at most
  2000 px), sent once. The JSON-repair retry never resends it.
- **Strict output:** `aiReplySchema` (zod) has one row per order/execution
  and, for every field, a value, a confidence and the exact text read. An
  unreadable answer is a plain 502 ("nothing was filled in"), never a guess.
- **Same rules as the offline reader** (`src/lib/ocr/ai-extract.ts`):
  - filled in only at confidence >= 0.8 with source text;
  - side maps to direction and entry vs exit (sell closes a long, cover
    closes a short);
  - "filled" status is only a suggestion;
  - cancelled and pending rows are listed but not offered;
  - code checks (qty × price vs total, stop-limit order, dates, symbol)
    turn a whole row into suggestions;
  - a multi-row screenshot lets the user pick the row.
- **Prompt injection:** the prompt says the image is data, and the reply
  only fills form fields the user confirms. Nothing the model writes can act
  on the account.
- **Eval:**
  - `npm run ocr:eval-ai -- --live` (your own key, via env) records answers;
  - replay is free and deterministic;
  - `npm test` replays recordings and fails on any wrong auto-fill;
  - no recordings exist yet, because that needs a real key.
- **Copy kept true:** the dialog, privacy page, FAQ, "How it works" and the
  tour no longer say screenshots are *never* sent to an AI. They say it
  happens only if you choose it.

