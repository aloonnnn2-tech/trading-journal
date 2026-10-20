import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { captchaEnforced, createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * Deleting an account only from the emailed link (2026-10-20, second
 * version), on the dev project. The link ends in a one-time code that only
 * the email holds (/account/delete/confirm/<code>). No real email is sent:
 * the request row is written as the request route writes it (the code's
 * SHA-256), and the page is opened with the code -- the address Supabase's
 * email sends people to. Real mail to these fake addresses would burn the dev
 * mailer's tiny hourly allowance and count as bounces.
 */

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const newCode = () => randomBytes(32).toString("base64url");

async function recordRequest(userId: string, code: string, expiresInMs = 3_600_000) {
  const now = Date.now();
  const { error } = await admin.from("account_deletion_requests").upsert({
    user_id: userId,
    requested_at: new Date(now).toISOString(),
    expires_at: new Date(now + expiresInMs).toISOString(),
    token_hash: createHash("sha256").update(code).digest("hex"),
  });
  if (error) throw new Error(`could not record the request: ${error.message}`);
}

async function exists(userId: string) {
  const { data } = await admin.auth.admin.getUserById(userId);
  return Boolean(data?.user);
}

let user: TestUser;
test.beforeEach(async () => {
  user = await createTestUser();
});
test.afterEach(async () => {
  if (await exists(user.id)) await deleteTestUser(user.id);
});

test("the Account page offers an emailed link, not a type-your-email box", async ({ page }) => {
  await signIn(page, user);
  await page.goto("/account");
  await page.getByRole("button", { name: "Delete account" }).click();
  await expect(page.getByText(/We.ll email a confirmation link to/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Email me the link" })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
});

test("without the right code, nothing is deleted", async ({ page }) => {
  await signIn(page, user);

  let res = await page.request.delete("/api/account/delete", { data: { token: newCode() } });
  expect(res.status()).toBe(403);
  expect((await res.json()).reason).toBe("no_request");

  const code = newCode();
  await recordRequest(user.id, code);
  // A session alone -- what a thief or an injected script has -- isn't enough.
  res = await page.request.delete("/api/account/delete", { data: {} });
  expect((await res.json()).reason).toBe("wrong_link");
  res = await page.request.delete("/api/account/delete", { data: { token: newCode() } });
  expect(res.status()).toBe(403);
  expect((await res.json()).reason).toBe("wrong_link");

  await page.goto(`/account/delete/confirm/${newCode()}`);
  await expect(page.getByText("Your account wasn't deleted")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete my account" })).toHaveCount(0);
  expect(await exists(user.id)).toBe(true);
});

test("an expired link deletes nothing", async ({ page }) => {
  await signIn(page, user);
  const code = newCode();
  await recordRequest(user.id, code, 1_000);
  await new Promise((r) => setTimeout(r, 1_500));
  await page.goto(`/account/delete/confirm/${code}`);
  await expect(page.getByText(/expired/)).toBeVisible();
  expect(await exists(user.id)).toBe(true);
});

test("opened signed out (another browser): sign in, come back, and it works", async ({ page }) => {
  test.skip(await captchaEnforced(), "the dev project enforces CAPTCHA, so the password grant can't run here");
  const code = newCode();
  await recordRequest(user.id, code);

  await page.goto(`/account/delete/confirm/${code}?code=from-supabase`);
  await expect(page.getByRole("heading", { name: "Sign in to continue" })).toBeVisible();
  await page.getByRole("link", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(user.email);
  await page.locator('input[autocomplete="current-password"]').fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL(new RegExp(`/account/delete/confirm/${code}$`), { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Delete your account?" })).toBeVisible();
  expect(await exists(user.id)).toBe(true);
});

test("request, then the emailed link, then the button: the account is gone", async ({ page }) => {
  await signIn(page, user);
  const code = newCode();
  await recordRequest(user.id, code);

  // Supabase's email adds its own ?code=; the page ignores it.
  await page.goto(`/account/delete/confirm/${code}?code=from-supabase`);
  await expect(page.getByRole("heading", { name: "Delete your account?" })).toBeVisible();
  await expect(page.getByText(user.email)).toBeVisible();

  await page.getByRole("button", { name: "Delete my account" }).click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000 });
  await expect.poll(() => exists(user.id), { timeout: 15_000 }).toBe(false);
});
