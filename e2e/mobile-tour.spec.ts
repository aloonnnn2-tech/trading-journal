import { expect, test, type Page } from "@playwright/test";
import { createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * The guided tour on a phone, end to end (Alon, 2026-10-15: "there is no
 * next button and the tour words are stacked on other things").
 *
 * The card used to be pinned to the bottom of a phone, where the tab bar's
 * More and + sheets and the Quick trade form open, so it covered the very
 * button each step asked for. Every tap below is a real tap -- Playwright
 * refuses one on an element something else covers -- and at every step the
 * card must not overlap the spotlighted target (src/lib/tour/phone-placement.ts).
 *
 * Run alone with: npx playwright test mobile-tour
 */

let user: TestUser;

test.beforeAll(async () => {
  user = await createTestUser();
});

test.afterAll(async () => {
  await deleteTestUser(user.id);
});

test.use({
  viewport: { width: 360, height: 640 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
});

const card = (page: Page) => page.getByRole("region", { name: "Guided tour" });

/** The card and the spotlight ring share no pixels. */
async function expectCardClearOfTarget(page: Page, where: string) {
  await page.waitForTimeout(500);
  const overlap = await page.evaluate(() => {
    const c = document.querySelector('[aria-label="Guided tour"]')?.getBoundingClientRect();
    const r = document.querySelector(".rounded-xl.border-2.border-primary")?.getBoundingClientRect();
    if (!c || !r) return 0;
    const h = Math.max(0, Math.min(c.bottom, r.bottom) - Math.max(c.top, r.top));
    const w = Math.max(0, Math.min(c.right, r.right) - Math.max(c.left, r.left));
    return Math.round(h * w);
  });
  expect(overlap, `the tour card covers its target at ${where}`).toBe(0);
}

async function tapMoreThen(page: Page, label: string) {
  await expect(card(page)).toContainText(`Tap More at the bottom, then ${label}.`, { timeout: 15_000 });
  await expectCardClearOfTarget(page, `${label} (More button)`);
  await page.locator('[data-tour-id="nav-more"]').tap();
  await expect(card(page)).toContainText(`Tap ${label} in the menu.`);
  await expectCardClearOfTarget(page, `${label} (More sheet)`);
  await page.getByRole("dialog", { name: "More" }).getByRole("link", { name: label, exact: true }).tap();
}

async function tapTab(page: Page, label: string) {
  await expect(card(page)).toContainText(`Tap ${label} at the bottom.`, { timeout: 15_000 });
  await expectCardClearOfTarget(page, `${label} tab`);
  await page.locator("[data-mobile-tabbar]").getByRole("link", { name: label, exact: true }).tap();
}

async function next(page: Page) {
  await card(page).getByRole("button", { name: "Next" }).tap();
}

test("the core tour runs start to finish on a 360px phone", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, user);
  await page.getByRole("button", { name: /no thanks, start empty/i }).tap({ timeout: 30_000 });
  await page.getByRole("button", { name: /show me around/i }).tap({ timeout: 30_000 });

  await expect(card(page)).toContainText("Log your first trade", { timeout: 30_000 });
  await expectCardClearOfTarget(page, "Quick trade button");
  await page.locator('[data-tour-id="dashboard-quick-trade"]').filter({ visible: true }).first().tap();

  // The form is open: the card is a strip at the top, and Create trade is
  // reachable -- it used to sit under the card.
  await expect(card(page)).toContainText("Type a symbol", { timeout: 15_000 });
  await expect(card(page)).toHaveAttribute("data-dock", "strip");
  await expectCardClearOfTarget(page, "Quick trade form");
  await page.locator('[data-tour-id="quick-ticker"]').fill("AAPL");
  await page.locator('[data-tour-id="quick-create"]').tap();
  await page.waitForURL(/\/trades\/[0-9a-f-]{36}/, { timeout: 60_000 });

  await expect(card(page)).toContainText("Everything about it lives here", { timeout: 30_000 });
  await expectCardClearOfTarget(page, "trade hero");
  await next(page);
  await expect(card(page)).toContainText("Your rules grade every trade");
  await expectCardClearOfTarget(page, "plan adherence");
  await next(page);

  await tapMoreThen(page, "Strategies");
  await expect(card(page)).toContainText("Name the setups you trade", { timeout: 30_000 });
  await expectCardClearOfTarget(page, "Strategies");
  await next(page);

  // The Trades page hides its header buttons on a phone: the screenshot
  // importer is in the + sheet, and the tour says so.
  await tapTab(page, "Trades");
  await expect(card(page)).toContainText("Tap + at the bottom, then From a screenshot.", { timeout: 30_000 });
  await expect(card(page)).not.toContainText("Can’t find this");
  await expectCardClearOfTarget(page, "+ button");
  await page.locator('[data-tour-id="nav-add"]').tap();
  await expect(card(page)).toHaveAttribute("data-dock", "strip");
  await expectCardClearOfTarget(page, "+ sheet");
  await next(page);

  // The + sheet closes by itself, so More can be tapped.
  await tapMoreThen(page, "Insights");
  await expect(card(page)).toContainText("Mistakes, counted from the data", { timeout: 30_000 });
  await expectCardClearOfTarget(page, "Insights");
  await next(page);

  await tapTab(page, "Analytics");
  await expect(card(page)).toContainText("Where it pays off", { timeout: 30_000 });
  await expectCardClearOfTarget(page, "Analytics");
  await next(page);

  await expect(card(page)).toContainText("That's the core");
  await expectCardClearOfTarget(page, "account menu");
  await card(page).getByRole("button", { name: "Finish" }).tap();
  await expect(card(page)).toBeHidden();
});
