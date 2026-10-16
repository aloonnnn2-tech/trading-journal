import { expect, test, type Page } from "@playwright/test";
import { createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * "Sometimes my clicks don't register" (Alon, 2026-10-16). Measured on the
 * live site: nothing ever blocked a click, but a Trades tab or a menu link
 * left the page unchanged for one to three seconds while the server built
 * the next one, so the click looked ignored. Every navigation must now show
 * something at once: the clicked link's pending hint, or the page skeleton.
 */

let user: TestUser;
test.beforeAll(async () => {
  user = await createTestUser();
});
test.afterAll(async () => {
  await deleteTestUser(user.id);
});

/** Makes the server slow to answer for `path` -- a cold function on the live site. */
async function slowDown(page: Page, path: string, ms = 2500) {
  await page.route(
    (url) => url.pathname === path,
    async (route) => {
      await new Promise((r) => setTimeout(r, ms));
      await route.continue().catch(() => {});
    },
  );
}

/** Ms from now until a pending hint or a route skeleton is on screen. */
async function feedbackWithin(page: Page, budgetMs: number): Promise<number> {
  const start = Date.now();
  await expect(page.locator('[data-pending-hint="on"], [data-route-loading]').first()).toBeVisible({ timeout: budgetMs });
  return Date.now() - start;
}

/** A fresh account is asked about a demo journal, then offered the tour: answer both. */
async function skipFirstVisit(page: Page) {
  await page.getByRole("button", { name: /no thanks, start empty/i }).click({ timeout: 15_000 }).catch(() => {});
  await page.getByRole("button", { name: /explore on my own/i }).click({ timeout: 10_000 }).catch(() => {});
  await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0, { timeout: 10_000 });
}

test("a menu link shows it was clicked while a slow page loads", async ({ page }) => {
  await signIn(page, user);
  await skipFirstVisit(page);
  await slowDown(page, "/goals");

  await page.locator("header").getByRole("button", { name: "Analysis", exact: true }).click();
  await page.locator('header a[href="/goals"]').click();
  const ms = await feedbackWithin(page, 1_000);
  expect(ms).toBeLessThan(1_000);
  await page.waitForURL(/\/goals/, { timeout: 30_000 });
});

test("a Trades tab shows it was clicked while the list reloads", async ({ page }) => {
  await signIn(page, user);
  await skipFirstVisit(page);
  await page.goto("/trades");
  // At rest every hint is invisible: an always-on pulse once overrode the
  // hidden state and drew a ring on every tab and menu link.
  await page.waitForLoadState("networkidle");
  const visibleAtRest = await page.locator('span[aria-hidden].pointer-events-none.absolute.inset-0').evaluateAll((els) =>
    els.filter((el) => Number(getComputedStyle(el).opacity) > 0.01).length,
  );
  expect(visibleAtRest).toBe(0);
  await slowDown(page, "/trades");

  await page.getByRole("link", { name: /^Open \(/ }).click();
  const ms = await feedbackWithin(page, 1_000);
  expect(ms).toBeLessThan(1_000);
  await page.waitForURL(/status=open/, { timeout: 30_000 });
});

test("a click right after closing Quick trade still lands", async ({ page }) => {
  await signIn(page, user);
  await skipFirstVisit(page);

  await page.getByRole("button", { name: /quick trade/i }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  // A raw click at the link's position, the instant the dialog starts to
  // close -- no waiting for anything to finish animating. A fading backdrop
  // still catching clicks would swallow this one.
  const box = (await page.locator('header a[href="/strategies"]').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForURL(/\/strategies/, { timeout: 30_000 });
});
