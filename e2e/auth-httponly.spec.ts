import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { captchaEnforced, createTestUser, deleteTestUser, deleteUserByEmail, signIn, type TestUser } from "./fixtures/test-user";

/**
 * Sign-in on the server, with an HttpOnly session cookie (security gaps
 * pass, Phase 1b), through the real pages, routes and dev project:
 * the cookie exists but no page script can read it, and every flow that
 * used to run in the browser still works -- sign-in, the wrong-password
 * message, sign-out, sign-up, and setting a new password from a reset link.
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

async function sessionCookies(context: BrowserContext) {
  return (await context.cookies()).filter((c) => /^sb-.+-auth-token/.test(c.name));
}

async function signInWithForm(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  // The label also holds the "Forgot password?" link, so by autocomplete.
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("password sign-in sets an HttpOnly cookie no script can read, and the app works", async ({ page, context }) => {
  test.skip(await captchaEnforced(), "the dev project enforces CAPTCHA, so the password grant can't run here");
  await signInWithForm(page, user.email, user.password);
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

  const cookies = await sessionCookies(context);
  expect(cookies.length).toBeGreaterThan(0);
  for (const c of cookies) {
    expect(c.httpOnly, c.name).toBe(true);
    expect(c.sameSite, c.name).toBe("Lax");
  }
  expect(await page.evaluate(() => document.cookie)).not.toMatch(/sb-[^=]+-auth-token/);

  // Signed-in pages and API calls keep working on the cookie alone.
  await page.goto("/trades");
  await expect(page).toHaveURL(/\/trades/);
  const res = await page.request.post("/api/trades");
  expect(res.status()).toBe(201);
});

test("a wrong password says so, with the same message as before", async ({ page }) => {
  test.skip(await captchaEnforced(), "the dev project enforces CAPTCHA");
  await signInWithForm(page, user.email, "not-the-password-1A!");
  await expect(page.getByText("That email and password don't match an account.")).toBeVisible();
  // The same message for an address with no account: nothing to tell them apart.
  await signInWithForm(page, `nobody-${Date.now()}@tradinglens-e2e.invalid`, "not-the-password-1A!");
  await expect(page.getByText("That email and password don't match an account.")).toBeVisible();
});

test("sign-out clears the HttpOnly cookie and really signs out", async ({ page, context }) => {
  await signIn(page, user);
  expect((await sessionCookies(context)).length).toBeGreaterThan(0);

  const res = await page.request.post("/api/auth/sign-out");
  expect(res.ok()).toBe(true);
  expect(await sessionCookies(context)).toEqual([]);

  await page.goto("/trades");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("a cookie written before this change (script-readable) still works: nobody is signed out", async ({ page, context }) => {
  await signIn(page, user);
  const old = (await sessionCookies(context)).map((c) => ({ ...c, httpOnly: false }));
  await context.clearCookies();
  await context.addCookies(old);
  await page.goto("/trades");
  await expect(page).toHaveURL(/\/trades/);
});

test("a password reset link lets you set a new password, and it works", async ({ page, context }) => {
  test.skip(await captchaEnforced(), "the dev project enforces CAPTCHA");
  const reset = await createTestUser();
  try {
    const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email: reset.email });
    if (error || !data.properties) throw new Error(`could not mint link: ${error?.message}`);
    await page.goto(`/auth/confirm?token_hash=${data.properties.hashed_token}&type=recovery&next=/reset-password`);
    await page.getByRole("button", { name: /confirm|continue|reset/i }).first().click();
    await page.waitForURL(/\/reset-password/, { timeout: 30_000 });

    const fresh = `New!${Date.now()}Aa1`;
    await page.getByLabel(/^new password/i).fill(fresh);
    await page.getByLabel(/confirm/i).fill(fresh);
    await page.getByRole("button", { name: /update|set|save|change/i }).click();
    await expect(page.getByText("Password updated")).toBeVisible();

    await context.clearCookies();
    await signInWithForm(page, reset.email, fresh);
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  } finally {
    await deleteTestUser(reset.id);
  }
});

test("sign-up through the form makes an account (dev project: no confirmation step)", async ({ page }) => {
  test.skip(await captchaEnforced(), "the dev project enforces CAPTCHA");
  const email = `e2e-signup-${Date.now()}@tradinglens-e2e.invalid`;
  try {
    await page.goto("/sign-up");
    await page.getByLabel("Email").fill(email);
    await page.locator('input[autocomplete="new-password"]').fill(`Su!${Date.now()}Aa1`);
    await page.getByRole("checkbox").check();
    const answered = page.waitForResponse((r) => r.url().endsWith("/api/auth/sign-up"));
    await page.getByRole("button", { name: /create account|sign up/i }).click();
    const res = await answered;
    expect(res.status()).toBe(200);
    // Dev has no confirmation step, so a session came back and the page moves on.
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const made = data.users.find((u) => u.email === email);
    expect(made).toBeTruthy();
    expect(made!.user_metadata).toMatchObject({ age_confirmed: true });
  } finally {
    await deleteUserByEmail(email);
  }
});
