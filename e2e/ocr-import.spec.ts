import path from "node:path";
import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * Import a trade from a broker screenshot.
 *
 * **What this tests, and what it deliberately does not.** The OCR pipeline's
 * ACCURACY already has a dedicated harness -- `npm run ocr:eval`, with real
 * fixtures and scored expectations in scripts/ocr-eval. Re-testing accuracy
 * here would duplicate it slowly, in a browser, and would make this suite fail
 * whenever a model or a preprocessing step changed rather than when the app
 * broke.
 *
 * So this covers the WIRING, which nothing else does: that a parse result
 * reaches the form, that confidence is surfaced to the user, and -- the one
 * that would silently corrupt data -- that a value the user corrects is the
 * value that gets saved, not the OCR guess it replaced.
 *
 * The upload is a real file (a fixture from the OCR eval set, so the request
 * is genuinely multipart with real image bytes); only the parse RESPONSE is
 * stubbed, which is what makes the assertions deterministic.
 */

let user: TestUser;

const FIXTURE = path.join(
  process.cwd(),
  "scripts/ocr-eval/fixtures/stocks/Trading_View_Gallery-7-7.png",
);

/** A high-confidence result, shaped like src/lib/ocr/types.ts ParseResult.
 *  Confidences sit above AUTOFILL_CONFIDENCE (0.55) so the form fills. */
const PARSE_RESULT = {
  ok: true,
  core: {
    ticker: { value: "NVDA", confidence: 0.94, source: "layout" },
    direction: { value: "long", confidence: 0.91, source: "layout" },
    status: { value: "open", confidence: 0.9, source: "layout" },
    entry_price: { value: 123.45, confidence: 0.88, source: "layout" },
    shares: { value: 10, confidence: 0.86, source: "layout" },
  },
  extra: [],
  screenshotType: "position",
  broker: "TradingView",
  log: { passes: [], notes: [] },
};

test.beforeAll(async () => {
  user = await createTestUser();
});

test.afterAll(async () => {
  await deleteTestUser(user.id);
});

test.beforeEach(async ({ page }) => {
  await page.route("**/api/ocr/parse", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(PARSE_RESULT),
    });
  });
});

async function openScreenshotImport(page: import("@playwright/test").Page) {
  await page.goto("/trades");
  await page
    .getByRole("button", { name: /explore on my own/i })
    .click({ timeout: 5_000 })
    .catch(() => {});
  await page.getByRole("button", { name: /from screenshot/i }).click();
  await page.locator('input[type="file"]').setInputFiles(FIXTURE);
}

test("auto-fills the form from the parse result and shows confidence", async ({ page }) => {
  await signIn(page, user);
  await openScreenshotImport(page);

  await expect(page.locator('input[value="NVDA"]').first()).toBeVisible({ timeout: 45_000 });

  // Confidence has to be VISIBLE to the user, not merely present in the
  // response -- the whole point of the badge is that someone can tell which
  // values to double-check before saving.
  await expect(page.getByTitle(/confidence/i).first()).toBeVisible();
});

test("a corrected value is what persists, not the OCR guess", async ({ page }) => {
  await signIn(page, user);
  await openScreenshotImport(page);

  const ticker = page.locator('input[value="NVDA"]').first();
  await expect(ticker).toBeVisible({ timeout: 45_000 });

  // The user disagrees with the OCR and fixes it before saving. This is the
  // regression that matters: if the form re-applied the parse result on
  // submit, the trade would be saved as NVDA and the correction lost with no
  // error shown to anyone.
  await ticker.fill("AMD");

  await page.getByRole("button", { name: /create trade/i }).click();
  await page.waitForURL(/\/trades\/[0-9a-f-]{36}/, { timeout: 60_000 });

  const saved = page.locator('input[placeholder="AAPL"]');
  await expect(saved).toHaveValue("AMD", { timeout: 30_000 });

  // And it is genuinely persisted, not just still in the DOM from the form.
  await page.reload();
  await expect(saved).toHaveValue("AMD", { timeout: 30_000 });
});
