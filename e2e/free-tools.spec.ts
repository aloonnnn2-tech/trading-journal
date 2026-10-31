import { expect, test, type Page } from "@playwright/test";
import { createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * The two free-tool pages (/position-size-calculator and
 * /how-to-journal-a-swing-trade), end to end: they open signed out AND signed
 * in -- unlike "/", which sends a signed-in visitor to /dashboard -- the
 * calculator answers as you type, nothing overflows a 375px phone, and the
 * landing page footer links to both. The math itself is covered by
 * src/lib/position-size/calculate.test.ts.
 */

const PAGES = [
  { path: "/position-size-calculator", h1: "Position size calculator" },
  { path: "/how-to-journal-a-swing-trade", h1: "How to journal a swing trade" },
];

let user: TestUser;

test.beforeAll(async () => {
  user = await createTestUser();
});
test.afterAll(async () => {
  await deleteTestUser(user.id);
});

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

for (const { path, h1 } of PAGES) {
  test(`${path} opens signed out, on a phone, without horizontal scroll`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole("heading", { level: 1, name: h1 })).toBeVisible();
    await expect(page.getByText("A trading journal and education tool. Not financial advice.")).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test(`${path} opens signed in, with no redirect to the dashboard`, async ({ page }) => {
    await signIn(page, user);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: h1 })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  });
}

test("the calculator answers as you type", async ({ page }) => {
  await page.goto("/position-size-calculator");
  const results = page.getByRole("region", { name: "Results" });

  // The defaults: 10000, 1%, 50.40 / 48.00, target 55.20.
  await expect(results.getByText("41", { exact: true })).toBeVisible();
  await expect(results.getByText("$98.40", { exact: true })).toBeVisible();
  await expect(results.getByText("2.00 : 1")).toBeVisible();

  await page.getByLabel("Stop price").fill("51");
  await expect(results.getByRole("status")).toHaveText("For a long trade, the stop must be below the entry.");

  await page.getByText("Short", { exact: true }).click();
  await page.getByLabel("Entry price").fill("50");
  await page.getByLabel("Stop price").fill("52");
  await page.getByLabel("Target price").fill("46");
  await expect(results.getByText("50", { exact: true })).toBeVisible();
  await expect(results.getByRole("status")).toHaveText("");
});

test("the landing page footer links to both free tools", async ({ page }) => {
  await page.goto("/");
  const tools = page.getByRole("navigation", { name: "Free tools" });
  await tools.getByRole("link", { name: "Position size calculator" }).click();
  await expect(page).toHaveURL(/\/position-size-calculator$/);

  await page.goto("/");
  await tools.getByRole("link", { name: "How to journal a swing trade" }).click();
  await expect(page).toHaveURL(/\/how-to-journal-a-swing-trade$/);
});

test("the journal template downloads", async ({ request }) => {
  const res = await request.get("/Swing-Trading-Journal-Template.xlsx");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("spreadsheetml.sheet");
});
