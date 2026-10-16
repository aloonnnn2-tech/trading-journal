import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * Yahoo down (production-readiness item 24): the chart says market data is
 * temporarily unavailable and offers to try again. It used to say "No price
 * history found -- try correcting the symbol", blaming the user's ticker for
 * an outage.
 */

let user: TestUser;
test.beforeAll(async () => {
  user = await createTestUser();
});
test.afterAll(async () => {
  await deleteTestUser(user.id);
});

test("a market-data outage reads as an outage, with a way to retry", async ({ page }) => {
  await signIn(page, user);
  const created = await page.request.post("/api/trades");
  const { id } = (await created.json()) as { id: string };
  const saved = await page.request.patch(`/api/trades/${id}`, { data: { core: { ticker: "AAPL" } } });
  expect(saved.ok()).toBe(true);

  let down = true;
  await page.route("**/api/market-data/**", (route) =>
    down
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          headers: { "Retry-After": "30" },
          body: JSON.stringify({ error: "Market data is temporarily unavailable. Try again in a minute." }),
        })
      : route.continue(),
  );

  await page.goto(`/trades/${id}`);
  await page.getByRole("button", { name: /no thanks, start empty/i }).click({ timeout: 10_000 }).catch(() => {});
  await page.getByRole("button", { name: /explore on my own/i }).click({ timeout: 10_000 }).catch(() => {});

  // The chart is further down the page and loads when it comes into view.
  const outage = page.getByText(/Market data is temporarily unavailable/);
  await expect(async () => {
    await page.mouse.wheel(0, 1500);
    await expect(outage).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByText(/Try correcting the symbol/)).toHaveCount(0);

  // Back up: Try again loads the chart without a reload.
  down = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText(/Market data is temporarily unavailable/)).toHaveCount(0, { timeout: 30_000 });
});
