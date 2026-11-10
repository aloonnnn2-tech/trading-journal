import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * A save the server refuses (Alon, 2026-11-09: "it didn't save some changes,
 * like selling part of my stocks or moving a stop loss"). On a trade with a
 * partial sale, lowering the share count to what was already sold is
 * refused. That used to show as a small "Save failed" and stay queued, so
 * the stop moved afterwards was refused along with it and both were gone on
 * the next visit. Now the page says why, and the stop saves on its own.
 */

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let user: TestUser;
test.beforeAll(async () => {
  user = await createTestUser();
});
test.afterAll(async () => {
  await deleteTestUser(user.id);
});

// The card's labels aren't tied to their inputs, so find the input beside one.
const field = (page: Page, label: string) =>
  page.locator(`xpath=//label[starts-with(normalize-space(.), "${label}")]/parent::div//input`).first();

const patched = (page: Page) =>
  page.waitForResponse((res) => res.request().method() === "PATCH" && /\/api\/trades\/[^/]+$/.test(res.url()));

test("a refused share count is explained, and the stop moved after it still saves", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, user);
  await page.getByRole("button", { name: /no thanks, start empty/i }).click({ timeout: 10_000 }).catch(() => {});
  await page.getByRole("button", { name: /explore on my own/i }).click({ timeout: 10_000 }).catch(() => {});

  // 100 bought at 50, 40 of them sold. A symbol with no market data, so
  // nothing fills or closes on its own.
  const { id } = (await (await page.request.post("/api/trades")).json()) as { id: string };
  const setup = await page.request.patch(`/api/trades/${id}`, {
    data: {
      core: {
        ticker: "ZZQX",
        direction: "long",
        status: "open",
        entry_price: 50,
        stop_loss: 45,
        shares: 100,
        entry_date: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        commission: 0,
      },
    },
  });
  expect(setup.ok(), await setup.text()).toBe(true);
  const sold = await page.request.post(`/api/trades/${id}/partial-exits`, {
    data: { sale: { date: new Date(Date.now() - 86_400_000).toISOString(), shares: 40, price: 60, reason: "reduce_risk" } },
  });
  expect(sold.ok(), await sold.text()).toBe(true);

  await page.goto(`/trades/${id}`);
  await expect(field(page, "Number of Shares")).toHaveValue("100", { timeout: 30_000 });

  // Lower the share count to what was already sold: refused, with the reason.
  const refusedSave = patched(page);
  await field(page, "Number of Shares").fill("40");
  expect((await refusedSave).status()).toBe(400);
  const alert = page.getByRole("alert").filter({ hasText: /isn't saved/ });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Shares isn't saved.");
  await expect(alert).toContainText("You hold 40 shares");
  await expect(page.getByText("Not saved: see above")).toBeVisible();

  // Move the stop: it saves, without the refused share count riding along.
  const stopSave = patched(page);
  await field(page, "Stop Loss").fill("48");
  const stopResponse = await stopSave;
  expect(stopResponse.ok()).toBe(true);
  expect(JSON.parse(stopResponse.request().postData() ?? "{}").core).not.toHaveProperty("shares");
  await expect
    .poll(async () => (await admin.from("trades").select("stop_loss, shares, risk_amount").eq("id", id).single()).data, {
      timeout: 15_000,
    })
    // Risk for the 100 shares that are saved, not the 40 on screen.
    .toMatchObject({ stop_loss: 48, shares: 100, risk_amount: 200 });
  // The share count is still not saved, and the page still says so.
  await expect(alert).toBeVisible();

  // Put the saved value back: the field shows 100 again and the alert goes.
  await alert.getByRole("button", { name: /Put the saved value back/ }).click();
  await expect(alert).toHaveCount(0);
  await expect(field(page, "Number of Shares")).toHaveValue("100");

  // A share count the trade can hold saves normally.
  const okSave = patched(page);
  await field(page, "Number of Shares").fill("80");
  expect((await okSave).ok()).toBe(true);
  await expect(page.getByRole("alert").filter({ hasText: /isn't saved/ })).toHaveCount(0);

  // After a reload the page shows exactly what was saved.
  await page.reload();
  await expect(field(page, "Number of Shares")).toHaveValue("80", { timeout: 30_000 });
  await expect(field(page, "Stop Loss")).toHaveValue("48");
});
