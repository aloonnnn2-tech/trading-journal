import { expect, test, type Page } from "@playwright/test";
import { createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * Two tabs editing the same field (production-readiness item 34). The second
 * save used to overwrite the first without a word. Now it is refused (409)
 * and the page asks: keep my change, or use the saved version.
 */

let user: TestUser;
test.beforeAll(async () => {
  user = await createTestUser();
});
test.afterAll(async () => {
  await deleteTestUser(user.id);
});

const TICKER = 'input[placeholder="AAPL"]';

async function open(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole("button", { name: /no thanks, start empty/i }).click({ timeout: 5_000 }).catch(() => {});
  await page.getByRole("button", { name: /explore on my own/i }).click({ timeout: 5_000 }).catch(() => {});
  await expect(page.locator(TICKER)).toBeVisible({ timeout: 30_000 });
}

async function saveTicker(page: Page, value: string) {
  const saved = page.waitForResponse((res) => res.request().method() === "PATCH" && /\/api\/trades\//.test(res.url()));
  await page.locator(TICKER).fill(value);
  await page.locator(TICKER).blur();
  return saved;
}

test("an edit to a field another tab changed asks instead of overwriting", async ({ browser }) => {
  test.setTimeout(180_000);
  const a = await browser.newPage();
  const b = await browser.newPage();
  await signIn(a, user);
  const { id } = (await (await a.request.post("/api/trades")).json()) as { id: string };
  const url = `/trades/${id}`;
  await signIn(b, user);
  await open(a, url);
  await open(b, url);

  // B saves first; A, still showing the old value, then changes the same field.
  expect((await saveTicker(b, "MSFT")).ok()).toBe(true);
  expect((await saveTicker(a, "NVDA")).status()).toBe(409);
  const alert = a.getByRole("alert").filter({ hasText: /changed somewhere else/ });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Ticker");

  // "Use the saved version": A shows B's value and nothing is overwritten.
  await alert.getByRole("button", { name: "Use the saved version" }).click();
  await expect(alert).toHaveCount(0);
  await expect(a.locator(TICKER)).toHaveValue("MSFT");
  await b.reload();
  await expect(b.locator(TICKER)).toHaveValue("MSFT", { timeout: 30_000 });

  // Again, and this time keep A's change: it is saved over B's.
  expect((await saveTicker(b, "AMD")).ok()).toBe(true);
  expect((await saveTicker(a, "META")).status()).toBe(409);
  const kept = a.waitForResponse((res) => res.request().method() === "PATCH" && res.ok());
  await a.getByRole("alert").getByRole("button", { name: "Keep my change" }).click();
  await kept;
  await b.reload();
  await expect(b.locator(TICKER)).toHaveValue("META", { timeout: 30_000 });
});

test("a change to a different field is not a conflict", async ({ browser }) => {
  const a = await browser.newPage();
  const b = await browser.newPage();
  await signIn(a, user);
  const { id } = (await (await a.request.post("/api/trades")).json()) as { id: string };
  await signIn(b, user);
  await open(a, `/trades/${id}`);
  await open(b, `/trades/${id}`);

  // B changes the stop through the API; A changes the ticker.
  const stop = await b.request.patch(`/api/trades/${id}`, { data: { core: { stop_loss: 95 } } });
  expect(stop.ok()).toBe(true);
  expect((await saveTicker(a, "TSLA")).ok()).toBe(true);
  await expect(a.getByRole("alert").filter({ hasText: /changed somewhere else/ })).toHaveCount(0);
});
