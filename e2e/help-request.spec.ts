import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * The Get help form, end to end on the dev project (2026-10-20): a visitor
 * who is NOT signed in sends a request through the real page, robot check
 * included (Cloudflare's always-pass test keys on this server); an admin sees
 * it in /admin/help, as text, and marks it answered; a non-admin can't open
 * that page. Needs migration 0075 on the dev project.
 */

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const stamp = Date.now();
const senderEmail = `help-${stamp}@tradinglens-e2e.invalid`;
// Markup in a message must show as characters on the admin page, never run.
const message = `E2E help ${stamp}: I can't sign in. <img src=x onerror="window.__pwned=1">`;

let adminUser: TestUser;
let plainUser: TestUser;

test.beforeAll(async () => {
  adminUser = await createTestUser();
  plainUser = await createTestUser();
  const { error } = await admin.from("user_settings").update({ is_admin: true }).eq("user_id", adminUser.id);
  if (error) throw new Error(`could not make the test admin: ${error.message}`);
});
test.afterAll(async () => {
  await admin.from("help_requests").delete().eq("email", senderEmail);
  await deleteTestUser(adminUser.id);
  await deleteTestUser(plainUser.id);
});

test("a signed-out visitor sends a help request and an admin answers it", async ({ page, browser }) => {
  await page.goto("/help?from=/sign-in");
  await page.getByLabel("Your email").fill(senderEmail);
  await page.getByLabel("What's it about?").selectOption("account");
  await page.getByLabel("How can we help?").fill(message);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Thanks, your message is in")).toBeVisible({ timeout: 30_000 });

  const { data: stored } = await admin.from("help_requests").select("user_id, topic, page, status").eq("email", senderEmail);
  expect(stored).toEqual([{ user_id: null, topic: "account", page: "/sign-in", status: "open" }]);

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signIn(adminPage, adminUser);
  await adminPage.goto("/admin/help");
  const card = adminPage.getByTestId("help-request").filter({ hasText: `E2E help ${stamp}` });
  await expect(card).toBeVisible();
  // The markup is on screen as text, and nothing ran.
  await expect(card.getByText('<img src=x onerror="window.__pwned=1">', { exact: false })).toBeVisible();
  expect(await adminPage.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  await expect(card.getByText("Not signed in")).toBeVisible();

  await card.getByRole("button", { name: "Mark answered" }).click();
  await expect(card.getByText("answered", { exact: true })).toBeVisible();
  const { data: after } = await admin.from("help_requests").select("status, handled_at").eq("email", senderEmail).single();
  expect(after?.status).toBe("answered");
  expect(after?.handled_at).toBeTruthy();
  await adminContext.close();
});

test("a filled honeypot is answered 'sent' and stores nothing", async ({ request }) => {
  const res = await request.post("/api/help", {
    data: { email: senderEmail, topic: "other", message: "spam spam spam spam", website: "http://spam.example" },
  });
  expect(res.ok()).toBe(true);
  const { count } = await admin.from("help_requests").select("id", { count: "exact", head: true }).eq("topic", "other").eq("email", senderEmail);
  expect(count).toBe(0);
});

test("a request with no robot-check token is refused", async ({ request }) => {
  const res = await request.post("/api/help", {
    data: { email: senderEmail, topic: "bug", message: "no token on this one at all" },
  });
  expect(res.status()).toBe(400);
});

test("a signed-in user who isn't an admin can't open the Help tab", async ({ page }) => {
  await signIn(page, plainUser);
  await page.goto("/admin/help");
  await expect(page).toHaveURL(/\/dashboard/);
});
