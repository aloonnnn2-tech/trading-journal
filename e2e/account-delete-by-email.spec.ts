import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * Deleting an account only from the emailed link (2026-10-20), on the dev
 * project. No real email is sent: the request row is written as the request
 * route writes it, and the link is minted with the admin API -- the same
 * token_hash link the Magic link template carries
 * (docs/security/delete-account-email.md). Sending real mail to these fake
 * addresses would burn the dev mailer's tiny hourly allowance and count as
 * bounces.
 */

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function recordRequest(userId: string, expiresInMs = 3_600_000) {
  const now = Date.now();
  const { error } = await admin.from("account_deletion_requests").upsert({
    user_id: userId,
    requested_at: new Date(now).toISOString(),
    expires_at: new Date(now + expiresInMs).toISOString(),
  });
  if (error) throw new Error(`could not record the request: ${error.message}`);
}

/** Make sure the next timestamp is in a later second than the last sign-in. */
const nextSecond = () => new Promise((r) => setTimeout(r, 2_100));

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

test("without a request, or from a session older than the request, nothing is deleted", async ({ page }) => {
  await signIn(page, user); // an emailed-link sign-in, but BEFORE any request

  let res = await page.request.delete("/api/account/delete");
  expect(res.status()).toBe(403);
  expect((await res.json()).reason).toBe("no_request");

  await nextSecond();
  await recordRequest(user.id);
  res = await page.request.delete("/api/account/delete");
  expect(res.status()).toBe(403);
  expect((await res.json()).reason).toBe("needs_link");

  await page.goto("/account/delete/confirm");
  await expect(page.getByText("Your account wasn't deleted")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete my account" })).toHaveCount(0);
  expect(await exists(user.id)).toBe(true);
});

test("an expired request deletes nothing, even from a fresh link", async ({ page }) => {
  await recordRequest(user.id, 1_000);
  await new Promise((r) => setTimeout(r, 1_500));
  const { data } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  await page.goto(`/auth/confirm?token_hash=${data.properties!.hashed_token}&type=magiclink&next=/account/delete/confirm`);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/account\/delete\/confirm/);
  await expect(page.getByText(/expired/)).toBeVisible();
  expect(await exists(user.id)).toBe(true);
});

test("a used or foreign link from Supabase's default email says so, and deletes nothing", async ({ page }) => {
  // The default email's link comes back as ?code=; one this browser can't
  // exchange (used, expired, or from another browser) must not end on the
  // Google sign-in error.
  await signIn(page, user);
  await nextSecond();
  await recordRequest(user.id);
  await page.goto("/account/delete/confirm?code=not-a-real-code");
  await page.waitForURL(/\/account\/delete\/confirm\?link=failed/, { timeout: 30_000 });
  await expect(page.getByText("That link didn't work.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete my account" })).toHaveCount(0);
  expect(await exists(user.id)).toBe(true);
});

test("request, then the emailed link, then the button: the account is gone", async ({ page }) => {
  await recordRequest(user.id);
  await new Promise((r) => setTimeout(r, 1_100)); // the link is opened after the request
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  if (error || !data.properties) throw new Error(`could not mint link: ${error?.message}`);

  await page.goto(`/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink&next=/account/delete/confirm`);
  await expect(page.getByRole("heading", { name: "Confirm it's you" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/account\/delete\/confirm/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Delete your account?" })).toBeVisible();
  await expect(page.getByText(user.email)).toBeVisible();

  await page.getByRole("button", { name: "Delete my account" }).click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000 });
  await expect.poll(() => exists(user.id), { timeout: 15_000 }).toBe(false);
});
