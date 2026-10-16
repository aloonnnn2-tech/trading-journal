import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * The model picker in Ask (2026-10-16). There is no real provider key in the
 * test environment, so the provider's answers are faked at the browser
 * boundary: the key row is real (dev project, service role), the live model
 * list and the save are intercepted. What this pins is the picker itself --
 * it loads the key's models, leaves out the ones that can't chat, labels
 * the obvious sizes, and saves the choice through the real PATCH shape.
 */

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let user: TestUser;
let keyId: string;

test.beforeAll(async () => {
  user = await createTestUser();
  // Ask is a paid feature; `plan` is set by the service role only.
  const plan = await admin.from("user_settings").update({ plan: "paid" }).eq("user_id", user.id);
  if (plan.error) throw plan.error;
  const key = await admin
    .from("user_api_keys")
    .insert({ user_id: user.id, provider: "openai", encrypted_key: "test-not-a-real-key", last_four: "TEST", is_active: true, model: "gpt-5-mini" })
    .select("id")
    .single();
  if (key.error) throw key.error;
  keyId = key.data.id;
});

test.afterAll(async () => {
  await deleteTestUser(user.id);
});

test("the picker offers the key's chat models and saves the choice", async ({ page }) => {
  await page.route(`**/api/ai-keys/${keyId}/test`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, message: "Working.", models: ["gpt-5", "gpt-5-mini", "text-embedding-3-large", "whisper-1"] }),
    }),
  );
  let saved: string | null = null;
  await page.route(`**/api/ai-keys/${keyId}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    saved = (route.request().postDataJSON() as { model: string }).model;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: keyId, provider: "openai", label: null, last_four: "TEST", is_active: true, model: saved, created_at: new Date().toISOString() }),
    });
  });

  await signIn(page, user);
  await page.getByRole("button", { name: /no thanks, start empty/i }).click({ timeout: 15_000 }).catch(() => {});
  await page.getByRole("button", { name: /explore on my own/i }).click({ timeout: 10_000 }).catch(() => {});
  await page.goto("/ask");

  await page.getByRole("button", { name: "gpt-5-mini" }).click({ timeout: 30_000 });
  const select = page.getByRole("combobox", { name: "Model" });
  await expect(select).toBeVisible();
  const options = await select.locator("option").allTextContents();
  expect(options).toEqual(["gpt-5", "gpt-5-mini — smaller, faster"]);

  await select.selectOption("gpt-5");
  await expect.poll(() => saved).toBe("gpt-5");
  await expect(page.getByRole("button", { name: "gpt-5", exact: true })).toBeVisible();
});
