import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser, getUserMetadata, signIn, type TestUser } from "./fixtures/test-user";

/**
 * "How did you hear about us?" on a new account's first sign-in (Alon,
 * 2026-11-19): asked before the demo question, saved on the account, and
 * never asked again.
 */

let fresh: TestUser;
let skipper: TestUser;
test.beforeAll(async () => {
  fresh = await createTestUser({ askHeardFrom: true });
  skipper = await createTestUser({ askHeardFrom: true });
});
test.afterAll(async () => {
  await deleteTestUser(fresh.id);
  await deleteTestUser(skipper.id);
});

const question = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: "How did you hear about us?" });

test("asked first, answered with one tap, saved, and not asked again", async ({ page }) => {
  await signIn(page, fresh);
  await expect(question(page)).toBeVisible({ timeout: 30_000 });
  for (const label of ["YouTube", "Instagram", "TikTok", "Google search", "Other"]) {
    await expect(question(page).getByRole("button", { name: label, exact: true })).toBeVisible();
  }

  await question(page).getByRole("button", { name: "TikTok", exact: true }).click();
  await expect(question(page)).toBeHidden();
  // The demo question comes next, as before.
  await expect(page.getByRole("button", { name: /no thanks, start empty/i })).toBeVisible({ timeout: 15_000 });

  await expect.poll(async () => (await getUserMetadata(fresh.id)).heard_from, { timeout: 15_000 }).toBe("tiktok");

  // A reload is not a second first sign-in.
  await page.reload();
  await expect(page.getByRole("button", { name: /no thanks, start empty/i })).toBeVisible({ timeout: 30_000 });
  await expect(question(page)).toHaveCount(0);
});

test("Escape skips it, and the skip is remembered", async ({ page }) => {
  await signIn(page, skipper);
  await expect(question(page)).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(question(page)).toBeHidden();
  await expect.poll(async () => (await getUserMetadata(skipper.id)).heard_from, { timeout: 15_000 }).toBe("skipped");
});
