import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * The rebuilt Emotions page (2026-10-17) on a seeded journal: results by
 * emotion before / during / after, tilt, emotions before mistakes, over time
 * -- on a desktop and on a 360px phone with nothing scrolling sideways.
 */

let user: TestUser;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  user = await createTestUser();
  // The same seed the dev account uses: realistic trades with emotions.
  execFileSync(process.execPath, ["--import", "tsx", "scripts/seed-fake-data.mjs", user.email, user.password], {
    stdio: "pipe",
  });
});

test.afterAll(async () => {
  await deleteTestUser(user.id);
});

async function open(page: import("@playwright/test").Page) {
  await signIn(page, user);
  await page.getByRole("button", { name: /no thanks, start empty/i }).click({ timeout: 10_000 }).catch(() => {});
  await page.getByRole("button", { name: /explore on my own/i }).click({ timeout: 10_000 }).catch(() => {});
  await page.goto("/emotions");
}

test("shows results by emotion, tilt, mistakes and over time", async ({ page }) => {
  await open(page);
  await expect(page.getByText(/Emotions logged on \d+ of \d+ closed trades/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Results by emotion" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Trading after losses/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Emotions over time/ })).toBeVisible();

  // Each emotion links to its trades.
  const firstLink = page.getByRole("tabpanel").getByRole("link").first();
  await expect(firstLink).toHaveAttribute("href", /\/trades\?emotion=/);

  // During / After are their own tabs.
  await page.getByRole("tab", { name: /During/ }).click();
  await expect(page.getByRole("tab", { name: /During/ })).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: "test-results/emotions-desktop.png", fullPage: true });
});

test("fits a 360px phone", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await open(page);
  await expect(page.getByRole("heading", { name: "Results by emotion" })).toBeVisible({ timeout: 30_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: "test-results/emotions-phone.png", fullPage: true });
});
