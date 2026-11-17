import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * The trade page's "N to fill" list (outside review, 2026-11-14): it named
 * what was missing but was a dead end -- no way to go to the box it named, and
 * Escape did not close it. Each item now takes you to its box (opening the
 * Dates panel for the two dates), and Escape or a click elsewhere closes it.
 */

let user: TestUser;
test.beforeAll(async () => {
  user = await createTestUser();
});
test.afterAll(async () => {
  await deleteTestUser(user.id);
});

test("an item in the to-fill list takes you to its box; Escape and an outside click close it", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, user);
  await page.getByRole("button", { name: /no thanks, start empty/i }).click({ timeout: 10_000 }).catch(() => {});
  await page.getByRole("button", { name: /explore on my own/i }).click({ timeout: 10_000 }).catch(() => {});

  // Closed, with an exit price but no stop, entry date or exit date.
  const { id } = (await (await page.request.post("/api/trades")).json()) as { id: string };
  const setup = await page.request.patch(`/api/trades/${id}`, {
    data: {
      core: { ticker: "ZZQV", direction: "long", status: "closed", entry_price: 50, exit_price: 55, shares: 10 },
    },
  });
  expect(setup.ok(), await setup.text()).toBe(true);

  await page.goto(`/trades/${id}`);
  const indicator = page.getByRole("button", { name: /to fill/ });
  const list = page.getByText("Still needs");
  await expect(indicator).toBeVisible({ timeout: 30_000 });

  // Escape closes it.
  await indicator.click();
  await expect(list).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();

  // So does a click anywhere else.
  await indicator.click();
  await expect(list).toBeVisible();
  await page.mouse.click(4, 400);
  await expect(list).toBeHidden();

  // An item goes to its box and puts the cursor there.
  await indicator.click();
  await page.getByRole("button", { name: "Stop Loss", exact: true }).click();
  await expect(list).toBeHidden();
  await expect(page.locator('[data-trade-field="stop_loss"] input')).toBeFocused();

  // A date is behind the Dates chip: the item opens it first.
  await indicator.click();
  await page.getByRole("button", { name: "Exit Date", exact: true }).click();
  await expect(page.locator('[data-trade-field="exit_date"] input')).toBeVisible();
  await expect(page.locator('[data-trade-field="exit_date"] input')).toBeFocused();
});
