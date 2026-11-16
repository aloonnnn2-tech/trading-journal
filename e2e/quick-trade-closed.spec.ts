import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * Logging a trade that is already over, from Quick trade (outside review,
 * 2026-11-14: a new account's first trade scored the app 4/10). Status
 * offered "Closed" with nowhere to put the exit, so the trade saved with no
 * P/L, the dashboard said "Closed trades 1" beside a blank win rate,
 * Analytics said "No closed trades yet", and setting the stop while creating
 * it was reported as "Moved stop". One trade, all four checked.
 */

let user: TestUser;
test.beforeAll(async () => {
  user = await createTestUser();
});
test.afterAll(async () => {
  await deleteTestUser(user.id);
});

test("a closed trade logged from Quick trade counts everywhere, with no moved stop", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, user);
  await page.getByRole("button", { name: /no thanks, start empty/i }).click({ timeout: 10_000 }).catch(() => {});
  await page.getByRole("button", { name: /explore on my own/i }).click({ timeout: 10_000 }).catch(() => {});

  await page.getByRole("button", { name: "Quick trade" }).click();
  const dialog = page.getByRole("dialog", { name: "Quick Trade" });
  await expect(dialog).toBeVisible();

  // No exit fields until the trade is said to be closed.
  await expect(dialog.getByLabel("Exit Price")).toHaveCount(0);

  // A symbol with no market data, so nothing fills or closes on its own.
  await dialog.getByLabel("Ticker").fill("ZZQX");
  await dialog.getByLabel("Status").selectOption("closed");
  await dialog.getByLabel("Entry Price").fill("190");
  await dialog.getByLabel("Number of Shares").fill("10");
  await dialog.getByLabel("Stop Loss").fill("185");

  // Closed with no exit price is asked for, not saved half-finished.
  await dialog.getByRole("button", { name: "Create trade" }).click();
  await expect(dialog.getByText(/needs its exit price and exit date/)).toBeVisible();

  // Both dates arrive filled in with today.
  await expect(dialog.getByLabel("Exit Date")).not.toHaveValue("");
  await expect(dialog.getByLabel("Entry Date")).not.toHaveValue("");

  await dialog.getByLabel("Exit Price").fill("198");
  const created = page.waitForResponse(
    (res) => res.request().method() === "POST" && /\/api\/trades$/.test(res.url()),
  );
  await dialog.getByRole("button", { name: "Create trade" }).click();
  const response = await created;
  expect(response.status(), await response.text()).toBe(201);

  const trade = (await response.json()) as {
    id: string;
    status: string;
    result: string;
    dollar_pl: number | null;
    exit_date: string | null;
    entry_date: string | null;
  };
  expect(trade.status).toBe("closed");
  expect(trade.result).toBe("win");
  expect(trade.dollar_pl).toBeCloseTo(80, 2);
  expect(trade.exit_date).not.toBeNull();
  expect(trade.entry_date).not.toBeNull();

  await page.waitForURL(new RegExp(`/trades/${trade.id}`), { timeout: 60_000 });

  // Dashboard: counted, with a win rate, and nothing left to explain.
  await page.goto("/dashboard");
  await expect(page.getByText("100%").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/no exit date/)).toHaveCount(0);

  // Analytics has the trade.
  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/no exit date/)).toHaveCount(0);
  await expect(page.getByText("No closed trades yet.")).toHaveCount(0);

  // Setting the stop while creating the trade is not a moved stop.
  await page.goto("/insights");
  await expect(page.getByRole("heading", { name: "Insights" }).first()).toBeVisible({ timeout: 30_000 });
  // The empty state's own sentence mentions "moved stops", so the check is
  // that the page counted the trade and found nothing, not that the words
  // are absent.
  await expect(page.getByText("Recurring errors across your 1 closed trade.", { exact: false })).toBeVisible();
  await expect(page.getByText(/No mistakes found yet/)).toBeVisible();
});

test("a closed trade with no exit date is named on the dashboard instead of contradicting it", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, user);
  await page.getByRole("button", { name: /no thanks, start empty/i }).click({ timeout: 10_000 }).catch(() => {});
  await page.getByRole("button", { name: /explore on my own/i }).click({ timeout: 10_000 }).catch(() => {});

  // Straight through the API, the way an import or an older trade gets here.
  const { id } = (await (await page.request.post("/api/trades")).json()) as { id: string };
  const setup = await page.request.patch(`/api/trades/${id}`, {
    data: {
      core: { ticker: "ZZQY", direction: "long", status: "closed", entry_price: 50, exit_price: 55, shares: 10 },
    },
  });
  expect(setup.ok(), await setup.text()).toBe(true);

  await page.goto("/dashboard");
  const notice = page.getByRole("status").filter({ hasText: /no exit date/ });
  await expect(notice).toContainText("ZZQY is closed but has no exit date", { timeout: 30_000 });
  await notice.getByRole("link", { name: "Add the exit date" }).click();
  await page.waitForURL(new RegExp(`/trades/${id}`), { timeout: 60_000 });
});

test("closing a trade on its page fills in today's exit date and shows it", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, user);
  await page.getByRole("button", { name: /no thanks, start empty/i }).click({ timeout: 10_000 }).catch(() => {});
  await page.getByRole("button", { name: /explore on my own/i }).click({ timeout: 10_000 }).catch(() => {});

  const { id } = (await (await page.request.post("/api/trades")).json()) as { id: string };
  const setup = await page.request.patch(`/api/trades/${id}`, {
    data: {
      core: {
        ticker: "ZZQW",
        direction: "long",
        status: "open",
        entry_price: 50,
        stop_loss: 45,
        shares: 10,
        entry_date: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      },
    },
  });
  expect(setup.ok(), await setup.text()).toBe(true);

  await page.goto(`/trades/${id}`);
  // The card's labels aren't tied to their controls, so find the one beside it.
  const beside = (label: string, control: "input" | "select") =>
    page.locator(`xpath=//label[starts-with(normalize-space(.), "${label}")]/parent::div//${control}`).first();
  await expect(beside("Status", "select")).toHaveValue("open", { timeout: 30_000 });

  const saved = page.waitForResponse(
    (res) => res.request().method() === "PATCH" && new RegExp(`/api/trades/${id}$`).test(res.url()),
  );
  await beside("Status", "select").selectOption("closed");

  // The Dates panel opens by itself, with today in it.
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  await expect(beside("Exit Date", "input")).toBeVisible();
  await expect(beside("Exit Date", "input")).toHaveValue(today);

  const response = await saved;
  expect(response.ok()).toBe(true);
  const sent = JSON.parse(response.request().postData() ?? "{}") as { core?: Record<string, unknown> };
  expect(sent.core).toMatchObject({ status: "closed", exit_date: today });
});
