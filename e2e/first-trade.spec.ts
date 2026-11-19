import { expect, test, type Page } from "@playwright/test";
import { createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * First run (Alon, 2026-11-19), in this order:
 *   1. "Welcome to Trading Lenz", with the demo-data question on the same card;
 *   2. "How did you hear about us?";
 *   3. "Log your first trade" -- the screenshot import, with a sample to try,
 *      Quick trade for typing it, and a skip -- in place of the tour, which
 *      stays in the menu.
 * Choosing demo data skips step 3: switching to your own journal later
 * deletes every trade in the account, so a first trade logged there would go.
 *
 * Goal it is held to: a new account's first trade in under two minutes.
 */

let sampleUser: TestUser;
let typingUser: TestUser;
let demoUser: TestUser;
test.beforeAll(async () => {
  sampleUser = await createTestUser({ firstRun: true });
  typingUser = await createTestUser({ firstRun: true });
  demoUser = await createTestUser({ firstRun: true });
});
test.afterAll(async () => {
  await deleteTestUser(sampleUser.id);
  await deleteTestUser(typingUser.id);
  await deleteTestUser(demoUser.id);
});

const welcome = (page: Page) => page.getByRole("dialog", { name: "Welcome to Trading Lenz" });
const heardFrom = (page: Page) => page.getByRole("dialog", { name: "How did you hear about us?" });
const firstTrade = (page: Page) => page.getByRole("dialog", { name: "Log your first trade" });

/** Welcome (start empty) and the question, the way a new user meets them. */
async function throughWelcome(page: Page, heard: string) {
  await expect(welcome(page)).toBeVisible({ timeout: 30_000 });
  await welcome(page).getByRole("button", { name: "No thanks, start empty" }).click();
  await expect(heardFrom(page)).toBeVisible({ timeout: 15_000 });
  await heardFrom(page).getByRole("button", { name: heard, exact: true }).click();
}

test("welcome, then the question, then the sample trade: logged in under two minutes", async ({ page }) => {
  test.setTimeout(180_000);
  const started = Date.now();
  await signIn(page, sampleUser);

  // The welcome comes first, with the tour pointed to rather than started.
  await expect(welcome(page)).toBeVisible({ timeout: 30_000 });
  await expect(welcome(page)).toContainText("Want to use demo data first?");
  await expect(welcome(page)).toContainText("Guided tours");
  await expect(heardFrom(page)).toHaveCount(0);
  await expect(firstTrade(page)).toHaveCount(0);
  await throughWelcome(page, "YouTube");

  // Then the first trade, not the tour.
  await expect(firstTrade(page)).toBeVisible({ timeout: 15_000 });
  await expect(firstTrade(page).getByText("Click, paste, or drag a screenshot here")).toBeVisible();
  await expect(page.getByRole("region", { name: "Guided tour" })).toHaveCount(0);

  await firstTrade(page).getByRole("button", { name: /try a sample trade/i }).click();
  const sample = page.getByRole("dialog", { name: "Your sample trade" });
  const create = sample.getByRole("button", { name: "Create trade" });
  await expect(create).toBeEnabled({ timeout: 90_000 });
  await expect(sample.getByLabel("Ticker")).toHaveValue("AAPL");
  await create.click();

  await page.waitForURL(/\/trades\/[0-9a-f-]{36}/, { timeout: 60_000 });
  await expect(page.locator('[data-trade-field="ticker"] input')).toHaveValue("AAPL", { timeout: 30_000 });
  const seconds = (Date.now() - started) / 1000;
  console.log(`first trade logged ${seconds.toFixed(1)}s after signing in`);
  expect(seconds).toBeLessThan(120);

  // First run is over for good.
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: "Quick trade" }).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await expect(welcome(page)).toHaveCount(0);
  await expect(firstTrade(page)).toHaveCount(0);
});

test("'Type it in instead' opens Quick trade; closing it comes back; creating a trade ends first run", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, typingUser);
  await throughWelcome(page, "TikTok");
  await expect(firstTrade(page)).toBeVisible({ timeout: 15_000 });

  const quick = page.getByRole("dialog", { name: "Quick Trade" });
  await firstTrade(page).getByRole("button", { name: "Type it in instead" }).click();
  await expect(quick).toBeVisible({ timeout: 15_000 });
  await expect(firstTrade(page)).toHaveCount(0);

  // Closed without a trade: back to the first-trade screen.
  await page.keyboard.press("Escape");
  await expect(firstTrade(page)).toBeVisible({ timeout: 10_000 });

  await firstTrade(page).getByRole("button", { name: "Type it in instead" }).click();
  await expect(quick).toBeVisible({ timeout: 15_000 });
  await quick.getByLabel("Ticker").fill("ZZQA");
  await quick.getByRole("button", { name: "Create trade" }).click();
  await page.waitForURL(/\/trades\/[0-9a-f-]{36}/, { timeout: 60_000 });
  await page.waitForTimeout(1000);
  await expect(firstTrade(page)).toHaveCount(0);
  await expect(heardFrom(page)).toHaveCount(0);
});

test("choosing demo data: welcome, the question, then the demo journal, with no first-trade screen", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, demoUser);
  await expect(welcome(page)).toBeVisible({ timeout: 30_000 });
  await welcome(page).getByRole("button", { name: "Yes, show me demo data" }).click();
  await expect(heardFrom(page)).toBeVisible({ timeout: 60_000 });
  await heardFrom(page).getByRole("button", { name: "Google search", exact: true }).click();
  await expect(heardFrom(page)).toBeHidden();
  await page.waitForTimeout(1500);
  await expect(firstTrade(page)).toHaveCount(0);
  // The demo journal is in: its trades are listed.
  await page.goto("/trades");
  await expect(page.getByRole("link", { name: /^[A-Z]{1,5}$/ }).first()).toBeVisible({ timeout: 30_000 });
});
