import { expect, test } from "@playwright/test";

/**
 * Where a sign-up came from (outside review, 2026-11-14). The first visit's
 * UTM tags are noted in this tab only, survive the move to the sign-up page,
 * and are not overwritten by a later page without tags.
 */

const stored = (page: import("@playwright/test").Page) =>
  page.evaluate(() => sessionStorage.getItem("tl-attribution"));

test("the first visit's utm tags are kept for the sign-up, and nothing is sent while browsing", async ({ page }) => {
  const sent: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST") sent.push(req.url());
  });

  await page.goto("/?utm_source=TikTok&utm_medium=bio&utm_campaign=launch");
  await expect.poll(() => stored(page), { timeout: 30_000 }).not.toBeNull();
  expect(JSON.parse((await stored(page)) ?? "{}")).toEqual({ source: "tiktok", medium: "bio", campaign: "launch" });

  // On to the sign-up page, and a later visit with other tags: the first stays.
  await page.goto("/sign-up?utm_source=other");
  await expect(page.getByRole("button", { name: /create account|sign up/i }).first()).toBeVisible({ timeout: 30_000 });
  expect(JSON.parse((await stored(page)) ?? "{}")).toMatchObject({ source: "tiktok" });

  // Browsing sent no attribution anywhere.
  expect(sent.filter((u) => /attribution|sign-up/.test(u))).toEqual([]);
});

test("a visit with no tags and no outside referrer stores nothing", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "See how it works" })).toBeVisible({ timeout: 30_000 });
  expect(await stored(page)).toBeNull();
});
