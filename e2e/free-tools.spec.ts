import { expect, test, type Page } from "@playwright/test";
import { FREE_TOOLS, FREE_TOOLS_HUB } from "../src/lib/free-tools";
import { createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * The free-tool pages (src/lib/free-tools.ts plus the /free-tools hub), end
 * to end: every one opens signed out AND signed in -- unlike "/", which sends
 * a signed-in visitor to /dashboard -- with nothing overflowing a 375px
 * phone; the interactive ones answer as you type; the landing page footer
 * and the hub link to them. The math is unit-tested in src/lib.
 */

const PAGES = [FREE_TOOLS_HUB, ...FREE_TOOLS.map((t) => t.path)];

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

test("every free-tool page opens signed out, on a phone, without horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page, path).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole("heading", { level: 1 }), path).toHaveCount(1);
    await expect(
      page.locator("footer").getByText("A trading journal and education tool. Not financial advice."),
      path,
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
});

test("every free-tool page opens signed in, with no redirect to the dashboard", async ({ page }) => {
  await signIn(page, user);
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }), path).toBeVisible();
    await expect(page, path).toHaveURL(new RegExp(`${path}$`));
  }
});

test("the position size calculator answers as you type", async ({ page }) => {
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

test("the risk/reward calculator answers as you type", async ({ page }) => {
  await page.goto("/risk-reward-calculator");
  const results = page.getByRole("region", { name: "Results" });

  await expect(results.getByText("2.00 : 1")).toBeVisible();
  await expect(results.getByText("33.3%")).toBeVisible();

  await page.getByLabel("Shares").fill("41");
  await expect(results.getByText("$98.40")).toBeVisible();
  await expect(results.getByText("$196.80")).toBeVisible();

  await page.getByLabel("Target price").fill("57.60");
  await expect(results.getByText("3.00 : 1")).toBeVisible();
  await expect(results.getByText("25.0%")).toBeVisible();

  await page.getByLabel("Target price").fill("49");
  await expect(results.getByRole("status")).toHaveText("For a long trade, the target must be above the entry.");
});

test("the checklist counts ticks and resets", async ({ page }) => {
  await page.goto("/trading-checklist");
  const boxes = page.getByRole("checkbox");
  const total = await boxes.count();
  expect(total).toBeGreaterThan(5);

  await expect(page.getByText(`0 of ${total} checked`)).toBeVisible();
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await expect(page.getByText(`2 of ${total} checked`)).toBeVisible();

  for (let i = 2; i < total; i++) await boxes.nth(i).check();
  await expect(page.getByText("All clear. Ready to trade.")).toBeVisible();

  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByText(`0 of ${total} checked`)).toBeVisible();
});

test("the trading plan builder previews what you type and copies it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/trading-plan-template");
  const preview = page.getByRole("region", { name: "Plan preview" });

  await expect(preview.getByText("Your plan appears here")).toBeVisible();
  await page.getByLabel("Your name").fill("Sam");
  await page.getByLabel("Markets").fill("US stocks over $5");
  await expect(preview.getByRole("heading", { name: "Trading plan: Sam" })).toBeVisible();
  await expect(preview.getByText("US stocks over $5")).toBeVisible();

  await preview.getByRole("button", { name: "Copy as text" }).click();
  await expect(preview.getByText("Copied")).toBeVisible();
  // The Windows clipboard stores line breaks as \r\n.
  const copied = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
  expect(copied).toBe("TRADING PLAN: Sam\n\nWHAT I TRADE\nMarkets: US stocks over $5");

  await page.getByRole("button", { name: "Fill in an example" }).click();
  await expect(preview.getByText("Exit rules")).toBeVisible();
});

test("the R multiple converter divides the result by the risk", async ({ page }) => {
  await page.goto("/what-is-an-r-multiple");
  const answer = page.locator("p", { hasText: "That trade made" });
  await expect(answer).toContainText("+1.75R");
  await page.getByLabel("Profit or loss").fill("-98.40");
  await expect(answer).toContainText("−1.00R");
});

test("the landing page footer and the hub link to the free tools", async ({ page }) => {
  await page.goto("/");
  const footerTools = page.getByRole("navigation", { name: "Free tools" });
  await footerTools.getByRole("link", { name: "Risk/reward calculator" }).click();
  await expect(page).toHaveURL(/\/risk-reward-calculator$/);

  await page.goto("/");
  await footerTools.getByRole("link", { name: "All free tools" }).click();
  await expect(page).toHaveURL(/\/free-tools$/);
  for (const tool of FREE_TOOLS) {
    await expect(page.getByRole("link", { name: new RegExp(tool.name.replace(/[?/]/g, ".")) }).first()).toHaveAttribute(
      "href",
      tool.path,
    );
  }
});

test("the journal template downloads", async ({ request }) => {
  const res = await request.get("/Swing-Trading-Journal-Template.xlsx");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("spreadsheetml.sheet");
});
