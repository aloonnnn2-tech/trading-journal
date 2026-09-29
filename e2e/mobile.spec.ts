import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * The phone layout (below 640px): every app page fits the screen, and the
 * bottom tab bar replaces the top nav.
 *
 * Real mobile emulation -- isMobile honours the viewport meta tag, which a
 * narrow desktop window does not -- at the two widths that matter: 360px
 * (small Android) and 390px (iPhone 12-16). A page wider than the screen is
 * what Alon saw on his phone as "it cuts mid lines"; this is the guard that
 * keeps it from coming back as new UI lands.
 *
 * Run alone with: npx playwright test mobile
 */

const ROUTES = [
  "/dashboard",
  "/trades",
  "/trades/import",
  "/strategies",
  "/analytics",
  "/insights",
  "/goals",
  "/reports",
  "/emotions",
  "/ask",
  "/reviews",
  "/fields",
  "/commissions",
  "/settings",
  "/account",
];

let user: TestUser;

test.beforeAll(async () => {
  user = await createTestUser();
});

test.afterAll(async () => {
  await deleteTestUser(user.id);
});

for (const width of [360, 390]) {
  test.describe(`phone ${width}px`, () => {
    test.use({
      viewport: { width, height: 740 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    });

    test("every app page fits the screen, with the tab bar and no top nav", async ({ page }) => {
      await signIn(page, user);
      // One trade, so the trade page is covered too.
      const res = await page.request.post("/api/trades");
      expect(res.ok()).toBe(true);
      const trade = (await res.json()) as { id: string };

      for (const route of [...ROUTES, `/trades/${trade.id}`]) {
        await page.goto(route);
        await page.waitForLoadState("networkidle");
        const m = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          tabBar: document.querySelector("[data-mobile-tabbar]")?.getBoundingClientRect().height ?? 0,
          topNav: document.querySelector("header nav")?.getBoundingClientRect().height ?? 0,
        }));
        expect(m.scrollWidth, `${route} is wider than the screen`).toBeLessThanOrEqual(m.innerWidth);
        expect(m.tabBar, `${route} has no tab bar`).toBeGreaterThan(0);
        expect(m.topNav, `${route} still shows the top nav`).toBe(0);
      }
    });

    test("More opens every other page and closes on navigation", async ({ page }) => {
      await signIn(page, user);
      await page.goto("/dashboard");
      await page.getByRole("button", { name: "More", exact: true }).tap();
      const sheet = page.getByRole("dialog", { name: "More" });
      await expect(sheet).toBeVisible();
      await sheet.getByRole("link", { name: "Settings" }).tap();
      await page.waitForURL("**/settings");
      await expect(sheet).toHaveCount(0);
    });
  });
}
