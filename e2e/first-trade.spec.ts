import { expect, test, type Page } from "@playwright/test";
import { createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * First run, rebuilt around one goal (2026-11-19): a new account logs its
 * first trade in under two minutes. Sign-ups were leaving before logging
 * anything, behind a demo-journal question, a welcome card and a tour.
 *
 * The first screen is now the screenshot import, with a sample screenshot to
 * try, Quick trade for typing it, and a skip. Nothing else comes first.
 */

let sampleUser: TestUser;
let typingUser: TestUser;
test.beforeAll(async () => {
  sampleUser = await createTestUser({ firstRun: true });
  typingUser = await createTestUser({ firstRun: true });
});
test.afterAll(async () => {
  await deleteTestUser(sampleUser.id);
  await deleteTestUser(typingUser.id);
});

const firstTrade = (page: Page) => page.getByRole("dialog", { name: "Log your first trade" });
const heardFrom = (page: Page) => page.getByRole("dialog", { name: "How did you hear about us?" });

test("the first screen is the screenshot import, and the sample trade is logged in under two minutes", async ({ page }) => {
  test.setTimeout(180_000);
  const started = Date.now();
  await signIn(page, sampleUser);

  // Straight to it: no demo question, no welcome card, no tour.
  await expect(firstTrade(page)).toBeVisible({ timeout: 30_000 });
  await expect(firstTrade(page).getByText("Click, paste, or drag a screenshot here")).toBeVisible();
  await expect(page.getByRole("button", { name: /show me around|start empty/i })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Guided tour" })).toHaveCount(0);

  // The sample goes through the real reader, then needs one click.
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

  // Then, and only then, the one question; first run is over for good.
  await expect(heardFrom(page)).toBeVisible({ timeout: 15_000 });
  await heardFrom(page).getByRole("button", { name: "Skip" }).click();
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: "Quick trade" }).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await expect(firstTrade(page)).toHaveCount(0);
});

test("'Type it in instead' opens Quick trade; closing it comes back; creating a trade ends first run", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, typingUser);
  await expect(firstTrade(page)).toBeVisible({ timeout: 30_000 });

  const quick = page.getByRole("dialog", { name: "Quick Trade" });
  await firstTrade(page).getByRole("button", { name: "Type it in instead" }).click();
  await expect(quick).toBeVisible({ timeout: 15_000 });
  await expect(firstTrade(page)).toHaveCount(0);

  // Closed without a trade: back to the first screen, not left with nothing.
  await page.keyboard.press("Escape");
  await expect(firstTrade(page)).toBeVisible({ timeout: 10_000 });

  await firstTrade(page).getByRole("button", { name: "Type it in instead" }).click();
  await expect(quick).toBeVisible({ timeout: 15_000 });
  await quick.getByLabel("Ticker").fill("ZZQA");
  await quick.getByRole("button", { name: "Create trade" }).click();
  await page.waitForURL(/\/trades\/[0-9a-f-]{36}/, { timeout: 60_000 });

  await expect(heardFrom(page)).toBeVisible({ timeout: 15_000 });
  await heardFrom(page).getByRole("button", { name: "Skip" }).click();
  await expect(firstTrade(page)).toHaveCount(0);
});
