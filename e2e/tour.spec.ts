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
 *
 * Since 2026-09-29 the tour never changes pages by itself: when the next stop
 * is on another page it points at the menu item and waits for the user to
 * click it ("Click Strategies in the menu."). And a fresh account is first
 * asked whether to start with a demo journal (Phase 4D); these tests answer
 * No, so the account stays empty as they expect.
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

  // A fresh account is first asked about the demo journal. Start empty.
  await page.getByRole("button", { name: /no thanks, start empty/i }).click({ timeout: 30_000 });

  // Then offered the tour. Take it.
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

  // ...then points the way to Strategies rather than going there itself.
  await card(page).getByRole("button", { name: "Next" }).click();
  await expect(card(page)).toContainText("Click Strategies in the menu", { timeout: 15_000 });
  await expect(page).toHaveURL(/\/trades\//);
  await page.locator('header [data-tour-id="nav-strategies"]').first().click();
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

  // Skip the two task steps: "I'll do this later" points the way to
  // Strategies, the first later step that has a page of its own.
  await card(page).getByRole("button", { name: /do this later/i }).click();
  await expect(card(page)).toContainText("Click Strategies in the menu", { timeout: 15_000 });
  await page.locator('header [data-tour-id="nav-strategies"]').first().click();
  await page.waitForURL(/\/strategies/, { timeout: 30_000 });
  await expect(card(page)).toContainText("Name the setups you trade", { timeout: 30_000 });

  // Wander off with the nav. The old tour would have ended here.
  await page.getByRole("link", { name: "Dashboard" }).first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  await expect(page.getByText(/tour paused/i)).toBeVisible({ timeout: 15_000 });
  // Resume points the way back rather than jumping there.
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(card(page)).toContainText("Click Strategies in the menu", { timeout: 15_000 });
  await page.locator('header [data-tour-id="nav-strategies"]').first().click();
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

// ---- The tour never guesses and never moves the page (2026-10-07) --------
//
// Its own account, so the trade it creates doesn't disturb the tests above.
test.describe("never guesses, never moves the page", () => {
  let fresh: TestUser;
  test.beforeAll(async () => {
    fresh = await createTestUser();
  });
  test.afterAll(async () => {
    await deleteTestUser(fresh.id);
  });

  /** Everything the card says over `ms`, sampled every 100ms. */
  async function cardTextsOver(page: Page, ms: number): Promise<string> {
    const seen = new Set<string>();
    const end = Date.now() + ms;
    while (Date.now() < end) {
      seen.add((await card(page).textContent({ timeout: 1000 }).catch(() => "")) ?? "");
      await page.waitForTimeout(100);
    }
    return [...seen].join(" || ");
  }

  test("closing the form goes back; a slow trade page is waited for; Back points the way", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, fresh);
    await page.getByRole("button", { name: /no thanks, start empty/i }).click({ timeout: 30_000 });
    await page.getByRole("button", { name: /show me around/i }).click({ timeout: 30_000 });
    await expect(card(page)).toContainText("Log your first trade", { timeout: 30_000 });

    // Closing Quick trade without creating anything: straight back to step 1,
    // on the same page.
    await page.getByRole("button", { name: /quick trade/i }).first().click();
    await expect(card(page)).toContainText("Just the essentials", { timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(card(page)).toContainText("Log your first trade", { timeout: 5_000 });
    await expect(page).toHaveURL(/\/dashboard/);

    // A trade page that takes 3s to arrive. The tour used to give up after
    // 1.5s and send the user back to "Log your first trade".
    await page.route(
      (url) => /^\/trades\/[0-9a-f-]{36}$/.test(url.pathname),
      async (route) => {
        await new Promise((r) => setTimeout(r, 3000));
        await route.continue();
      },
    );
    await page.getByRole("button", { name: /quick trade/i }).first().click();
    await expect(card(page)).toContainText("Just the essentials", { timeout: 15_000 });
    await page.locator('[data-tour-id="quick-ticker"]').fill("MSFT");
    await page.locator('[data-tour-id="quick-create"]').click();
    const during = await cardTextsOver(page, 2500);
    expect(during).toContain("Opening your trade");
    expect(during).not.toContain("Log your first trade");
    await expect(card(page)).toContainText("Everything about it lives here", { timeout: 30_000 });
    await page.unrouteAll({ behavior: "ignoreErrors" });

    // On to Strategies through the menu.
    await card(page).getByRole("button", { name: "Next" }).click();
    await expect(card(page)).toContainText("Your rules grade every trade");
    await card(page).getByRole("button", { name: "Next" }).click();
    await page.locator('header [data-tour-id="nav-strategies"]').first().click();
    await expect(card(page)).toContainText("Name the setups you trade", { timeout: 30_000 });

    // Back from Strategies: points at the trade it created -- never step 1,
    // and the page stays put until the user clicks.
    await card(page).getByRole("button", { name: "Back" }).click();
    await expect(card(page)).toContainText("Back: Trade", { timeout: 5_000 });
    await expect(card(page)).not.toContainText("Log your first trade");
    await page.waitForTimeout(1000);
    await expect(page).toHaveURL(/\/strategies/);
    await card(page).getByRole("link", { name: "Open your trade" }).click();
    await expect(card(page)).toContainText("Your rules grade every trade", { timeout: 30_000 });
  });

  test("replaying from another page points the way instead of going there", async ({ page }) => {
    await signIn(page, fresh);
    await page.goto("/insights");
    await page.getByTitle("Guided tours").click({ timeout: 30_000 });
    await page.getByRole("button", { name: /getting started/i }).click();
    await expect(card(page)).toContainText("Click Dashboard in the menu", { timeout: 15_000 });
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/insights/);
  });

  test("below 1000px, a Setup page is reached through the account menu", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await signIn(page, fresh);
    // Resume the full-toolkit tour at its Commissions stop.
    await page.evaluate(() => localStorage.setItem("tl-tour", JSON.stringify({ tour: "features", step: 6 })));
    await page.reload();
    await page.getByRole("button", { name: "Resume" }).click({ timeout: 30_000 });
    await expect(card(page)).toContainText("Open the account menu", { timeout: 15_000 });
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(card(page)).toContainText("Click Commissions in the menu", { timeout: 10_000 });
    await page.locator('[data-tour-id="nav-commissions"]').filter({ visible: true }).first().click();
    await expect(card(page)).toContainText("Fees, so P/L is always net", { timeout: 30_000 });
  });
});
