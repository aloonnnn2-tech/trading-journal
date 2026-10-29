import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * Partial sells (Alon, 2026-10-29): sell part of an open position before
 * earnings or to cut risk, keep the rest, and have every total count it.
 * The worked example: 100 bought at 50, 40 sold at 60 (+400), the other 60
 * at 55 (+300) -- the trade closes at +$700. Needs 0079 on the dev project.
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

test("sell part of an open trade, then close the rest: the P&L counts both", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, user);
  await page.getByRole("button", { name: /no thanks, start empty/i }).click({ timeout: 10_000 }).catch(() => {});
  await page.getByRole("button", { name: /explore on my own/i }).click({ timeout: 10_000 }).catch(() => {});

  const { id } = (await (await page.request.post("/api/trades")).json()) as { id: string };
  const entryDate = new Date(Date.now() - 3 * 86_400_000).toISOString();
  // A symbol with no market data, so nothing fills or closes on its own.
  const setup = await page.request.patch(`/api/trades/${id}`, {
    data: {
      core: {
        ticker: "ZZQX",
        direction: "long",
        status: "open",
        entry_price: 50,
        stop_loss: 45,
        shares: 100,
        entry_date: entryDate,
        commission: 0,
      },
    },
  });
  expect(setup.ok()).toBe(true);

  await page.goto(`/trades/${id}`);
  const panel = page.getByRole("region", { name: /Partial sells/ });
  await panel.getByRole("button", { name: "Sell part" }).click({ timeout: 30_000 });

  // 40% isn't a quick button: 25% fills 25, then type 40.
  await panel.getByRole("button", { name: "25%" }).click();
  await expect(panel.getByLabel(/^Shares/)).toHaveValue("25");
  await panel.getByLabel(/^Shares/).fill("40");
  await panel.getByLabel("Price", { exact: true }).fill("60");
  await panel.getByRole("button", { name: "Earnings coming up" }).click();
  await panel.getByLabel("Note (optional)").fill("earnings Thursday");
  await expect(panel.getByText("This sale: +$400.00")).toBeVisible();
  await panel.getByRole("button", { name: "Log sale" }).click();

  await expect(panel.getByText(/Sold 40 of 100 · 60 still held/)).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByText(/Earnings coming up · earnings Thursday/)).toBeVisible();

  const afterSale = await admin.from("trades").select("status, partial_exits, dollar_pl").eq("id", id).single();
  expect(afterSale.data?.status).toBe("open");
  expect(afterSale.data?.dollar_pl).toBeNull();
  expect(afterSale.data?.partial_exits).toEqual([
    expect.objectContaining({ shares: 40, price: 60, reason: "earnings", note: "earnings Thursday" }),
  ]);

  // You can't sell more than you hold -- refused by the server, said plainly.
  const tooMany = await page.request.post(`/api/trades/${id}/partial-exits`, {
    data: { sale: { date: new Date().toISOString(), shares: 70, price: 61, reason: "reduce_risk" } },
  });
  expect(tooMany.status()).toBe(400);
  expect((await tooMany.json()).error).toMatch(/close the trade instead/);

  // Sell the rest: the form closes the trade.
  await panel.getByRole("button", { name: "Sell part" }).click();
  await panel.getByRole("button", { name: "All" }).click();
  await panel.getByLabel("Price", { exact: true }).fill("55");
  await expect(panel.getByText(/That's everything you hold, so this closes the trade at \$55\.00/)).toBeVisible();
  await panel.getByRole("button", { name: "Sell all and close" }).click();

  await expect
    .poll(async () => (await admin.from("trades").select("status, exit_price, dollar_pl, result").eq("id", id).single()).data, {
      timeout: 15_000,
    })
    .toMatchObject({ status: "closed", exit_price: 55, dollar_pl: 700, result: "win" });
  await expect(panel.getByText(/60 closed at the exit price/)).toBeVisible();

  // Removing the sale recomputes the closed trade as one exit at 55: +500.
  await panel.getByRole("button", { name: "Remove" }).click();
  await panel.getByRole("button", { name: "Yes" }).click();
  await expect
    .poll(async () => (await admin.from("trades").select("dollar_pl").eq("id", id).single()).data?.dollar_pl, {
      timeout: 15_000,
    })
    .toBe(500);
});
