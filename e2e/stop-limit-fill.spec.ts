import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * A stop-limit order filled by the background sweep while its page sat open
 * (Alon, 2026-10-17: "the wrong price is saved after buy"). The fill must
 * keep the stop he typed, ask what he actually paid, offer the limit as one
 * tap -- and the price he gives must save, not be refused because the open
 * page didn't know about the fill.
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

test("a stop-limit filled in the background keeps the stop, asks for the fill, and the answer saves", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, user);
  await page.getByRole("button", { name: /no thanks, start empty/i }).click({ timeout: 10_000 }).catch(() => {});
  await page.getByRole("button", { name: /explore on my own/i }).click({ timeout: 10_000 }).catch(() => {});

  const { id } = (await (await page.request.post("/api/trades")).json()) as { id: string };
  // A symbol with no market data, so the page itself never fills it.
  const setup = await page.request.patch(`/api/trades/${id}`, {
    data: {
      core: {
        ticker: "ZZQX",
        direction: "long",
        status: "pending",
        order_type: "stop_limit",
        entry_price: 100,
        limit_price: 102,
        stop_loss: 95,
        shares: 10,
      },
    },
  });
  expect(setup.ok()).toBe(true);

  // The page is open with the order still pending...
  await page.goto(`/trades/${id}`);
  await expect(page.getByText("Pending Order").first()).toBeAttached({ timeout: 30_000 });

  // ...when the sweep fills it, exactly as the cron route writes a fill.
  const filledAt = new Date().toISOString();
  const fill = await admin.from("trades").update({ status: "open", entry_date: filledAt }).eq("id", id);
  if (fill.error) throw fill.error;
  const afterFill = await admin.from("trades").select("entry_price, order_price, fill_price_confirmed").eq("id", id).single();
  expect(afterFill.data).toMatchObject({ entry_price: 100, order_price: 100, fill_price_confirmed: false });

  // Back to the tab: the page re-reads the trade and asks for the fill.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("At what price did it fill?")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/between the stop \(100\) and the limit \(102\)/)).toBeVisible();

  await page.getByRole("button", { name: "Use the limit (102)" }).click();
  await page.getByRole("button", { name: "Save fill price" }).click();

  await expect
    .poll(async () => (await admin.from("trades").select("entry_price, fill_price_confirmed").eq("id", id).single()).data, {
      timeout: 15_000,
    })
    .toMatchObject({ entry_price: 102, fill_price_confirmed: true });
  await expect(page.getByText(/changed elsewhere|changed in another/i)).toHaveCount(0);
});
