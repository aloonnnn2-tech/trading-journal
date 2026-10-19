import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createTestUser, deleteTestUser, type TestUser } from "./fixtures/test-user";

/**
 * Emailed auth links survive being opened by something else first
 * (Alon, 2026-10-15: "when they click the link sometimes it's expired").
 *
 * Mail providers' link scanners open every link in an email before the
 * person does. When the link spent its one-time token on that GET, the
 * person's own click failed as "expired" -- for an account the scanner had
 * already confirmed -- and a resend sent nothing, since Supabase sends no
 * confirmation to a confirmed address.
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

async function mintLink(): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  if (error || !data.properties) throw new Error(`could not mint link: ${error?.message}`);
  return `/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink&next=/dashboard`;
}

test("a link opened by a scanner first still works for the person", async ({ page, request }) => {
  const link = await mintLink();

  // The scanner: a plain fetch of the link, twice for good measure.
  for (let i = 0; i < 2; i++) expect((await request.get(link)).ok()).toBe(true);

  await page.goto(link);
  await page.getByRole("button", { name: "Confirm my email" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
});

test("a link that really was used says the account may already be confirmed", async ({ browser }) => {
  const link = await mintLink();
  const first = await browser.newPage();
  await first.goto(link);
  await first.getByRole("button", { name: "Confirm my email" }).click();
  await first.waitForURL(/\/dashboard/, { timeout: 30_000 });
  await first.close();

  // A second person, browser or tab using the same link.
  const second = await browser.newPage();
  await second.goto(link);
  await second.getByRole("button", { name: "Confirm my email" }).click();
  await second.waitForURL(/\/sign-in\?error=confirmation_failed/, { timeout: 30_000 });
  await expect(second.getByText(/already used or has expired\. You may already be confirmed/)).toBeVisible();
  await second.close();
});

test("a link in Supabase's other format is handed on, not called incomplete", async ({ page }) => {
  // {{ .ConfirmationURL }} sends a code (or an error) instead of token_hash.
  await page.goto("/auth/confirm?code=not-a-real-code&next=/reset-password");
  await expect(page).toHaveURL(/\/sign-in\?error=oauth_failed/);

  await page.goto("/auth/confirm?error=access_denied&error_description=Email+link+is+invalid+or+has+expired");
  await expect(page).toHaveURL(/\/sign-in\?error=confirmation_failed/);
  await expect(page.getByText(/already used or has expired/)).toBeVisible();
});

test("only this site's own page can use a link", async ({ request }) => {
  const res = await request.post("/auth/confirm/verify", {
    headers: { origin: "https://evil.example" },
    form: { token_hash: "x", type: "magiclink" },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(403);
});
