import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser, getUserMetadata, signIn, type TestUser } from "./fixtures/test-user";

/**
 * "How did you hear about us?" (Alon, 2026-11-19): asked right after the
 * welcome card, before "Log your first trade" (first-trade.spec.ts has the
 * whole order). Saved on the account, never asked again.
 */

let fresh: TestUser;
let skipper: TestUser;
test.beforeAll(async () => {
  fresh = await createTestUser({ firstRun: true });
  skipper = await createTestUser({ firstRun: true });
});
test.afterAll(async () => {
  await deleteTestUser(fresh.id);
  await deleteTestUser(skipper.id);
});

const welcome = (page: import("@playwright/test").Page) => page.getByRole("dialog", { name: "Welcome to Trading Lenz" });
const question = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: "How did you hear about us?" });
const firstTrade = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: "Log your first trade" });

test("asked after the welcome, answered with one tap, saved, and not asked again", async ({ page }) => {
  await signIn(page, fresh);
  await expect(welcome(page)).toBeVisible({ timeout: 30_000 });
  await expect(question(page)).toHaveCount(0);
  await welcome(page).getByRole("button", { name: "No thanks, start empty" }).click();

  await expect(question(page)).toBeVisible({ timeout: 15_000 });
  for (const label of ["YouTube", "Instagram", "TikTok", "Google search", "Other"]) {
    await expect(question(page).getByRole("button", { name: label, exact: true })).toBeVisible();
  }
  await question(page).getByRole("button", { name: "TikTok", exact: true }).click();
  await expect(question(page)).toBeHidden();
  await expect.poll(async () => (await getUserMetadata(fresh.id)).heard_from, { timeout: 15_000 }).toBe("tiktok");

  // Next comes the first trade; skip it, and nothing comes back on a reload.
  await expect(firstTrade(page)).toBeVisible({ timeout: 15_000 });
  await firstTrade(page).getByRole("button", { name: "Skip for now" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Quick trade" }).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await expect(welcome(page)).toHaveCount(0);
  await expect(question(page)).toHaveCount(0);
  await expect(firstTrade(page)).toHaveCount(0);
});

test("Escape skips it, and the skip is remembered", async ({ page }) => {
  await signIn(page, skipper);
  await expect(welcome(page)).toBeVisible({ timeout: 30_000 });
  await welcome(page).getByRole("button", { name: "No thanks, start empty" }).click();
  await expect(question(page)).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(question(page)).toBeHidden();
  await expect.poll(async () => (await getUserMetadata(skipper.id)).heard_from, { timeout: 15_000 }).toBe("skipped");
  await expect(firstTrade(page)).toBeVisible({ timeout: 15_000 });
});
