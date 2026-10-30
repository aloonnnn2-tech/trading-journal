import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * Overall rules (Alon, 2026-10-29): write down the rules you trade by, and
 * every trade shows whether you kept them; each month adds it up. Real
 * prices: AAPL held for six weeks against a 5-day SMA exit rule (it closes
 * under its 5-day average within days, every time), so the rule is broken
 * and the trade card says when and what it cost. Needs 0081 on the dev
 * project, and Yahoo reachable.
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

test("rules on the Strategies page are checked on the trade and added up for the month", async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page, user);
  await page.getByRole("button", { name: /no thanks, start empty/i }).click({ timeout: 10_000 }).catch(() => {});
  await page.getByRole("button", { name: /explore on my own/i }).click({ timeout: 10_000 }).catch(() => {});

  // ---- The rules, made through the page -----------------------------------
  await page.goto("/strategies");
  const card = page.locator("div").filter({ has: page.getByRole("heading", { name: "Your overall rules" }) }).last();
  await card.getByRole("button", { name: "Moving-average exit" }).click();
  await card.getByLabel("Average days").fill("5");
  await card.getByLabel("Trading days to get out").fill("0");
  await card.getByLabel("Which trades").selectOption("long");
  await card.getByRole("button", { name: "Add rule" }).click();
  await expect(card.getByText("Exit when the close is below the SMA 5")).toBeVisible({ timeout: 15_000 });

  await card.getByRole("button", { name: "Trade value" }).click();
  await card.getByLabel("What to check").selectOption({ label: "Risk % of account" });
  await card.getByLabel("Comparison").selectOption({ label: "is at most" });
  await card.getByLabel("Value").fill("1");
  await card.getByRole("button", { name: "Add rule" }).click();
  await expect(card.getByText(/Risk % of account is at most 1/)).toBeVisible({ timeout: 15_000 });

  await card.getByRole("button", { name: "In words" }).click();
  await card.getByLabel("The rule").fill("No trades in the first 15 minutes");
  await card.getByRole("button", { name: "Add rule" }).click();
  await expect(card.getByText("No trades in the first 15 minutes")).toBeVisible({ timeout: 15_000 });

  // ---- A closed AAPL trade that held on past the close below the SMA 5 ----
  const { id } = (await (await page.request.post("/api/trades")).json()) as { id: string };
  const setup = await page.request.patch(`/api/trades/${id}`, {
    data: {
      core: {
        ticker: "AAPL",
        direction: "long",
        status: "closed",
        entry_price: 200,
        exit_price: 210,
        shares: 10,
        risk_percent: 2,
        entry_date: "2026-09-01",
        exit_date: "2026-10-15",
        commission: 0,
      },
    },
  });
  expect(setup.ok()).toBe(true);

  // ---- The trade page checks it against real prices -----------------------
  await page.goto(`/trades/${id}`);
  const rules = page.locator("[data-shot='overall-rules']");
  await expect(rules.getByText("Your rules")).toBeVisible({ timeout: 45_000 });
  // The price check may still be running on the first visit: reload until stored.
  await expect
    .poll(
      async () => {
        const { data } = await admin.from("trade_rule_checks").select("outcome").eq("trade_id", id);
        return data?.[0]?.outcome ?? null;
      },
      { timeout: 45_000 },
    )
    .toBe("broken");
  await page.reload();
  await expect(rules.getByText(/Closed below the SMA 5 on .*, 2026/)).toBeVisible({ timeout: 30_000 });
  await expect(rules.getByText(/trading days? late/)).toBeVisible();
  // Field rule: 2% risk against "at most 1".
  await expect(rules.getByText("Was 2.")).toBeVisible();
  // The rule in words is left to the AI review, never marked broken.
  await expect(rules.getByText("Judged in the AI review.")).toBeVisible();
  await expect(rules.getByText(/Kept 0\/2/)).toBeVisible();

  // ---- This month on the Strategies page ----------------------------------
  await page.goto("/strategies");
  const thisMonth = page.locator("div").filter({ has: page.getByRole("heading", { name: "This month" }) }).last();
  await expect(thisMonth.getByText(/0 of 1 trade kept every rule/)).toBeVisible({ timeout: 30_000 });
  await expect(thisMonth.getByRole("row", { name: /Exit when the close is below the SMA 5/ })).toContainText("0/1 (0%)");
  await expect(thisMonth.getByText(/judged by\s+the AI monthly review/)).toBeVisible();
});
