import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * Picking the right candle on a trade's chart (Alon, 2026-10-17: the chart
 * "sometimes shows the wrong candle you got in"). A click on a candle offers
 * "Set as entry candle"; choosing it saves the trade's entry date as that
 * candle's day. Real chart, real daily bars from the market-data route.
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

test("clicking a candle and choosing 'Set as entry candle' moves the entry date to it", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, user);
  await page.getByRole("button", { name: /no thanks, start empty/i }).click({ timeout: 10_000 }).catch(() => {});
  await page.getByRole("button", { name: /explore on my own/i }).click({ timeout: 10_000 }).catch(() => {});

  const { id } = (await (await page.request.post("/api/trades")).json()) as { id: string };
  const day = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  const setup = await page.request.patch(`/api/trades/${id}`, {
    data: {
      core: {
        ticker: "AAPL",
        direction: "long",
        status: "closed",
        order_type: "market",
        entry_price: 335,
        exit_price: 340,
        shares: 1,
        entry_date: day(30),
        exit_date: day(10),
      },
    },
  });
  expect(setup.ok()).toBe(true);
  const before = (await admin.from("trades").select("entry_date").eq("id", id).single()).data!.entry_date as string;

  await page.goto(`/trades/${id}`);
  const chart = page.locator("canvas").first();
  await expect(chart).toBeVisible({ timeout: 45_000 });

  // A candle a little left of centre: inside the holding period.
  await chart.scrollIntoViewIfNeeded();
  const box = (await chart.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
  const picker = page.getByTestId("candle-picker");
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("button", { name: "Set as exit candle" })).toBeVisible();
  const label = await picker.locator("span").first().textContent();

  await picker.getByRole("button", { name: "Set as entry candle" }).click();
  await expect(picker).toHaveCount(0);
  await expect
    .poll(async () => (await admin.from("trades").select("entry_date").eq("id", id).single()).data!.entry_date, { timeout: 15_000 })
    .not.toBe(before);

  const after = new Date((await admin.from("trades").select("entry_date").eq("id", id).single()).data!.entry_date as string);
  // The saved day is the candle the picker named (e.g. "Mon 21 Sep" / "21 Sep").
  const dayOfMonth = String(after.getUTCDate());
  expect(label).toContain(dayOfMonth);
  // A daily candle keeps a real time of day, never a bare midnight.
  expect(after.getUTCHours() + after.getUTCMinutes()).not.toBe(0);
});
