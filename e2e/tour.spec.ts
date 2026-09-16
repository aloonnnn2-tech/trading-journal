import { expect, test, type Page } from "@playwright/test";
import { createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * The guided tour -- specifically the thing that used to kill it.
 *
 * The old overlay treated any navigation it had not requested as the user
 * leaving, and ended the tour (marking it complete for good) unless the very
 * next step happened to be the trade-page one. So creating the trade from the
 * first step of the modal, rather than the third, ended the tour the moment
 * the trade page loaded. These tests do exactly that, and assert the tour is
 * on the trade-page step afterwards; then wander off with the nav and assert
 * it pauses and resumes rather than ending; then reload mid-tour and assert
 * it resumes. `has_completed_tour` must remain false throughout.
 */

let user: TestUser;

test.beforeAll(async () => {
  user = await createTestUser();
});

test.afterAll(async () => {
  await deleteTestUser(user.id);
});

const card = (page: Page) => page.getByRole("region", { name: "Guided tour" });

async function completedFlag(page: Page): Promise<boolean> {
  const res = await page.request.get("/api/settings/tour");
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { hasCompletedTour: boolean }).hasCompletedTour;
}

test("creating the trade from the first modal step carries the tour to the trade page", async ({ page }) => {
  await signIn(page, user);

  // A fresh account is offered the tour. Take it.
  await page.getByRole("button", { name: /show me around/i }).click({ timeout: 30_000 });
  await expect(card(page)).toContainText("Log your first trade", { timeout: 30_000 });

  // Step 1 is a task: the tour advances when Quick Trade opens.
  await page.getByRole("button", { name: /quick trade/i }).first().click();
  await expect(card(page)).toContainText("Just the essentials", { timeout: 15_000 });

  // Create the trade straight away -- without pressing Next -- which is the
  // exact move that used to end the tour.
  await page.locator('[data-tour-id="quick-ticker"]').fill("AAPL");
  await page.locator('[data-tour-id="quick-create"]').click();
  await page.waitForURL(/\/trades\/[0-9a-f-]{36}/, { timeout: 60_000 });

  await expect(card(page)).toContainText("Everything about it lives here", { timeout: 30_000 });
  await expect(card(page)).toContainText("Step 3 of 9");
  expect(await completedFlag(page)).toBe(false);

  // Next moves within the page to the Plan Adherence panel...
  await card(page).getByRole("button", { name: "Next" }).click();
  await expect(card(page)).toContainText("Your rules grade every trade");

  // ...and again navigates to Strategies on the tour's own initiative.
  await card(page).getByRole("button", { name: "Next" }).click();
  await page.waitForURL(/\/strategies/, { timeout: 30_000 });
  await expect(card(page)).toContainText("Name the setups you trade", { timeout: 30_000 });
});

test("wandering off pauses the tour; Resume brings it back; a reload keeps the place", async ({ page }) => {
  await signIn(page, user);
  // The flag is still false, so the welcome modal is offered again. Decline
  // it here (that does mark the tour complete) and replay from the "?" menu,
  // which is the path an existing user takes.
  await page
    .getByRole("button", { name: /explore on my own/i })
    .click({ timeout: 15_000 })
    .catch(() => {});
  await page.getByTitle("Guided tours").click();
  await page.getByRole("button", { name: /getting started/i }).click();
  await expect(card(page)).toContainText("Log your first trade", { timeout: 30_000 });

  // Skip the two task steps: "I'll do this later" lands on Strategies, the
  // first later step the tour can reach on its own.
  await card(page).getByRole("button", { name: /do this later/i }).click();
  await page.waitForURL(/\/strategies/, { timeout: 30_000 });
  await expect(card(page)).toContainText("Name the setups you trade", { timeout: 30_000 });

  // Wander off with the nav. The old tour would have ended here.
  await page.getByRole("link", { name: "Dashboard" }).first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  await expect(page.getByText(/tour paused/i)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Resume" }).click();
  await page.waitForURL(/\/strategies/, { timeout: 30_000 });
  await expect(card(page)).toContainText("Name the setups you trade", { timeout: 30_000 });

  // Reload: progress is kept.
  await page.reload();
  await expect(card(page)).toContainText("Name the setups you trade", { timeout: 30_000 });
  await expect(card(page)).toContainText("Step 5 of 9");

  // Escape ends it only when no dialog is open; here none is.
  await page.keyboard.press("Escape");
  await expect(card(page)).toBeHidden({ timeout: 10_000 });
});
