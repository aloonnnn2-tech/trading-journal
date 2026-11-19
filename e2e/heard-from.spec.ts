import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser, getUserMetadata, signIn, type TestUser } from "./fixtures/test-user";

/**
 * "How did you hear about us?" (Alon, 2026-11-19). Asked once first run ends,
 * so it never stands between a new account and its first trade (that screen
 * is first-trade.spec.ts). Saved on the account, never asked again.
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

const question = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: "How did you hear about us?" });
const firstTrade = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: "Log your first trade" });

test("asked after the first-trade screen, answered with one tap, saved, and not asked again", async ({ page }) => {
  await signIn(page, fresh);
  // The first trade comes first; the question waits.
  await expect(firstTrade(page)).toBeVisible({ timeout: 30_000 });
  await expect(question(page)).toHaveCount(0);
  await firstTrade(page).getByRole("button", { name: "Skip for now" }).click();

  await expect(question(page)).toBeVisible({ timeout: 15_000 });
  for (const label of ["YouTube", "Instagram", "TikTok", "Google search", "Other"]) {
    await expect(question(page).getByRole("button", { name: label, exact: true })).toBeVisible();
  }
  await question(page).getByRole("button", { name: "TikTok", exact: true }).click();
  await expect(question(page)).toBeHidden();
  await expect.poll(async () => (await getUserMetadata(fresh.id)).heard_from, { timeout: 15_000 }).toBe("tiktok");

  // A reload is not a second first sign-in: neither screen comes back.
  await page.reload();
  await expect(page.getByRole("button", { name: "Quick trade" }).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await expect(question(page)).toHaveCount(0);
  await expect(firstTrade(page)).toHaveCount(0);
});

test("Escape skips it, and the skip is remembered", async ({ page }) => {
  await signIn(page, skipper);
  await expect(firstTrade(page)).toBeVisible({ timeout: 30_000 });
  await firstTrade(page).getByRole("button", { name: "Skip for now" }).click();
  await expect(question(page)).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(question(page)).toBeHidden();
  await expect.poll(async () => (await getUserMetadata(skipper.id)).heard_from, { timeout: 15_000 }).toBe("skipped");
});
