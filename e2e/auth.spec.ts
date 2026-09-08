import { expect, test } from "@playwright/test";
import { deleteUserByEmail } from "./fixtures/test-user";

/**
 * Sign up, sign out, sign back in, plus the two failure paths that matter:
 * a wrong password, and the password-reset request.
 *
 * **The point of the wrong-password case.** src/lib/auth/error-messages.ts
 * exists so the SDK's own wording never reaches a user -- "Invalid login
 * credentials" is developer shorthand, and GoTrue is free to change it
 * between releases. That module is unit tested, but nothing until now checked
 * that the auth screens actually USE it. A regression there is invisible to
 * every existing test and visible to every user who mistypes a password.
 */

const password = "E2ePassw0rd!test";

// Located by autocomplete attribute rather than by label. The sign-in
// password label wraps a "Forgot password?" link, so its accessible name is
// "Password Forgot password?" and an exact getByLabel("Password") never
// matches -- a detail worth encoding once here rather than rediscovering.
const EMAIL = 'input[autocomplete="email"]';
const CURRENT_PASSWORD = 'input[autocomplete="current-password"]';
const NEW_PASSWORD = 'input[autocomplete="new-password"]';
// NOT getByRole("alert"): Next renders its own always-present route announcer
// as <div role="alert" id="__next-route-announcer__">, so the role matches two
// elements and strict mode fails before any assertion runs. FormError renders
// a <p role="alert">, which is unambiguous.
const FORM_ERROR = 'p[role="alert"]';
let email: string;

test.beforeEach(() => {
  email = `e2e-auth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@tradinglens-e2e.invalid`;
});

test.afterEach(async () => {
  // The sign-up FORM created this one, so the test never saw its id.
  // Cleanup is by email, and must run even when the test failed part-way.
  await deleteUserByEmail(email).catch(() => {});
});

test("sign up, sign out, then sign back in", async ({ page }) => {
  await page.goto("/sign-up");

  await page.locator(EMAIL).fill(email);
  await page.locator(NEW_PASSWORD).fill(password);
  await page.getByRole("button", { name: /sign up|create account/i }).click();

  // Email confirmation is switched off on this project, so signUp returns a
  // usable session and the app goes straight to the dashboard. If that
  // setting is ever turned back on this assertion is what will fail, loudly,
  // rather than the app quietly stranding new users.
  await page.waitForURL(/\/dashboard/, { timeout: 45_000 });

  await page.getByRole("button", { name: /sign out/i }).click();
  await page.waitForURL(/\/(sign-in)?$/, { timeout: 30_000 });

  await page.goto("/sign-in");
  await page.locator(EMAIL).fill(email);
  await page.locator(CURRENT_PASSWORD).fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();

  await page.waitForURL(/\/dashboard/, { timeout: 45_000 });
});

test("a wrong password shows the mapped message, never the raw Supabase one", async ({ page }) => {
  await page.goto("/sign-in");

  await page.locator(EMAIL).fill("definitely-not-a-user@tradinglens-e2e.invalid");
  await page.locator(CURRENT_PASSWORD).fill("wrong-password-entirely");
  await page.getByRole("button", { name: /^sign in$/i }).click();

  const alert = page.locator(FORM_ERROR);
  await expect(alert).toBeVisible();

  // The exact string from error-messages.ts for `invalid_credentials`.
  await expect(alert).toHaveText(/don't match an account/i);

  // And explicitly NOT GoTrue's own wording. Asserting the positive alone
  // would still pass if both were rendered.
  await expect(alert).not.toHaveText(/invalid login credentials/i);
});

test("a password reset request is accepted and confirmed", async ({ page }) => {
  await page.goto("/forgot-password");

  await page.locator(EMAIL).fill(email);
  await page.getByRole("button", { name: /send|reset/i }).click();

  // Delivery of the email is out of scope -- this asserts the request was
  // accepted and the UI said so.
  await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 30_000 });
});
