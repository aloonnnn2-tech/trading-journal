import { expect, test } from "@playwright/test";

/**
 * The floating "Leave a review" button on the homepage (outside review,
 * 2026-11-14): on a phone it sat on top of the hero's "See how it works".
 * It now waits there until the hero's buttons have scrolled away. Wider
 * screens are unchanged: it is there from the start.
 */

const floating = '[data-track="review-cta-floating"]';

test("on a phone the review button stays away until the hero's buttons are gone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "See how it works" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(floating)).toBeHidden();

  await page.locator("#how-it-works").scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 900);
  await expect(page.locator(floating)).toBeVisible();
});

test("on a desktop the review button is there from the start", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.locator(floating)).toBeVisible({ timeout: 30_000 });
});
