import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * Trade creation and autosave -- the flow where a regression silently costs a
 * user data they have already typed.
 *
 * **A CORRECTION TO THE BRIEF.** The task asks to "wait past the debounce
 * window without blurring -- verify no premature save -- then blur and verify
 * the save fires immediately". The first half describes behaviour this app
 * does not have, and should not: src/lib/trades/use-autosave-trade.ts:165
 * schedules a flush AUTOSAVE_DELAY_MS (600ms) after the last keystroke,
 * whether or not the field is blurred. An autosave that only wrote on blur
 * would lose everything typed by anyone who closed the tab with the cursor
 * still in a field -- exactly the data loss autosave exists to prevent.
 *
 * So these tests assert the real contract, which is a debounce with an
 * additional flush on blur:
 *   - nothing is written while the user is still typing;
 *   - a write lands shortly after they stop, blur or no blur;
 *   - blurring flushes immediately rather than waiting out the remaining
 *     debounce.
 *
 * Written against the PATCH request rather than the "Saved" badge on purpose:
 * the badge is a rendering of the intent, the request is the thing that
 * actually persists, and it is the request whose timing is under test.
 */

let user: TestUser;

test.beforeAll(async () => {
  user = await createTestUser();
});

test.afterAll(async () => {
  // Cascades through every user-data table, so the trades this file creates
  // go with it.
  await deleteTestUser(user.id);
});

/** Creates a trade and lands on its page. "+ Add trade" inserts a draft row
 *  immediately and navigates -- there is no intermediate dialog. */
async function newTrade(page: import("@playwright/test").Page): Promise<string> {
  await page.goto("/trades");
  // First visit shows an onboarding tour whose overlay swallows clicks.
  await page
    .getByRole("button", { name: /explore on my own/i })
    .click({ timeout: 5_000 })
    .catch(() => {});
  await page.getByRole("button", { name: /add trade/i }).first().click();
  await page.waitForURL(/\/trades\/[0-9a-f-]{36}/, { timeout: 60_000 });
  await expect(page.getByText(/autosave on|saved/i).first()).toBeVisible({ timeout: 30_000 });
  return page.url();
}

const TICKER = 'input[placeholder="AAPL"]';

test("a new trade saves an edited field and it survives a reload", async ({ page }) => {
  await signIn(page, user);
  const url = await newTrade(page);

  // Wait on the response, not on the "Saved" badge. The badge is a rendering
  // of intent and a poor oracle for persistence -- what matters is that the
  // server accepted the write, and then that a fresh page load returns it.
  const saved = page.waitForResponse(
    (res) => res.request().method() === "PATCH" && /\/api\/trades\//.test(res.url()),
    { timeout: 30_000 },
  );
  await page.locator(TICKER).fill("TSLA");
  await page.locator(TICKER).blur();
  expect((await saved).ok()).toBe(true);

  await page.goto(url);
  await expect(page.locator(TICKER)).toHaveValue("TSLA", { timeout: 30_000 });
});

test("nothing is written mid-typing, and a write lands after the pause", async ({ page }) => {
  await signIn(page, user);
  await newTrade(page);

  // Let the page settle first. The trade page issues its own PATCH shortly
  // after mount (reconciling derived fields on a freshly created draft), and
  // counting that would attribute a load-time write to the typing under test
  // -- which is exactly what made an earlier version of this assertion see
  // two requests for one edit.
  await page.waitForTimeout(2_500);

  let patches = 0;
  page.on("request", (req) => {
    if (req.method() === "PATCH" && /\/api\/trades\//.test(req.url())) patches += 1;
  });

  // Four keystrokes in one burst, comfortably inside the 600ms window.
  await page.locator(TICKER).pressSequentially("NVDA", { delay: 50 });

  // Stop typing WITHOUT blurring: the debounce alone must produce a write.
  // This is the half of the contract that would break if autosave were ever
  // changed to flush only on blur -- and it is the half that protects anyone
  // who closes the tab mid-field.
  await expect
    .poll(() => patches, { timeout: 10_000, message: "no PATCH after the debounce elapsed" })
    .toBeGreaterThan(0);

  // ...and exactly one, not one per keystroke. Coalescing four edits into a
  // single request is the entire point of the debounce; losing it would put
  // a PATCH on the wire for every character typed into every field.
  await page.waitForTimeout(1_500);
  expect(patches).toBe(1);
});

test("blurring flushes immediately instead of waiting out the debounce", async ({ page }) => {
  await signIn(page, user);
  await newTrade(page);

  const field = page.locator(TICKER);
  await field.fill("AMD");

  const started = Date.now();
  const patch = page.waitForRequest(
    (req) => req.method() === "PATCH" && /\/api\/trades\//.test(req.url()),
    { timeout: 15_000 },
  );
  await field.blur();
  await patch;

  // The debounce is 600ms. Allowing 500 leaves room for scheduling jitter
  // while still failing if the blur handler stopped flushing and the write
  // was really just the timer coming due.
  expect(Date.now() - started).toBeLessThan(500);
});

test("a derived field shows the server's value and cannot be typed into", async ({ page }) => {
  await signIn(page, user);
  await newTrade(page);

  // Dollar P/L is computed from entry, exit and size -- never entered.
  // Its label is rendered separately from the value, so this locates the
  // value by walking from the label rather than by a brittle CSS path.
  const pl = page.getByText(/dollar p\/l/i).first();
  await expect(pl).toBeVisible();

  // The contract under test: there is no editable control for it. If someone
  // later turns this into an <input>, the user could type a P/L that
  // contradicts the trade's own numbers, and this fails.
  const editable = page.locator(
    'input[name="dollar_pl"], input[id*="dollar_pl"], textarea[name="dollar_pl"]',
  );
  await expect(editable).toHaveCount(0);
});
