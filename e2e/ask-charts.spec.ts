import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * The "Let Ask see my chart screenshots" switch (2026-10-17). Charts send the
 * image itself to the provider, which the chat's own agreement never
 * mentioned, so they are their own consent, per provider, that the user can
 * also withdraw. Real routes and the real consent table (dev project); no
 * provider is called.
 */

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let user: TestUser;

test.beforeAll(async () => {
  user = await createTestUser();
  const plan = await admin.from("user_settings").update({ plan: "paid" }).eq("user_id", user.id);
  if (plan.error) throw plan.error;
  const keys = await admin.from("user_api_keys").insert([
    { user_id: user.id, provider: "openai", label: "vision", encrypted_key: "test-not-a-real-key", last_four: "OPEN", is_active: true, model: "gpt-5-mini" },
    { user_id: user.id, provider: "groq", label: "text", encrypted_key: "test-not-a-real-key", last_four: "GROQ", is_active: true, model: "openai/gpt-oss-120b" },
  ]);
  if (keys.error) throw keys.error;
});

test.afterAll(async () => {
  await deleteTestUser(user.id);
});

async function consentRows() {
  const { data } = await admin
    .from("ai_provider_consents")
    .select("provider")
    .eq("user_id", user.id)
    .eq("scope", "chat_images_v1");
  return (data ?? []).map((r) => r.provider);
}

/** Picks the saved key whose option names this provider. */
async function pickKey(page: import("@playwright/test").Page, provider: string) {
  const select = page.locator("form select").first();
  const label = (await select.locator("option").allTextContents()).find((t) => t.startsWith(provider));
  if (!label) throw new Error(`no ${provider} key in the picker`);
  await select.selectOption({ label });
}

test("chart viewing asks first, sticks, can be switched off, and isn't offered to text-only providers", async ({ page }) => {
  await signIn(page, user);
  await page.getByRole("button", { name: /no thanks, start empty/i }).click({ timeout: 15_000 }).catch(() => {});
  await page.getByRole("button", { name: /explore on my own/i }).click({ timeout: 10_000 }).catch(() => {});
  await page.goto("/ask");

  await pickKey(page, "OpenAI");
  const box = page.getByRole("checkbox", { name: "Let Ask see my chart screenshots" });
  await expect(box).not.toBeChecked({ timeout: 30_000 });

  // On: the disclosure comes first, and nothing is recorded until it's accepted.
  await box.click();
  await expect(page.getByText(/the image itself is sent/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(box).not.toBeChecked();
  expect(await consentRows()).toEqual([]);

  await box.click();
  await page.getByRole("button", { name: /I understand/ }).click();
  await expect(box).toBeChecked();
  await expect.poll(consentRows).toEqual(["openai"]);

  await page.reload();
  await pickKey(page, "OpenAI");
  await expect(page.getByRole("checkbox", { name: "Let Ask see my chart screenshots" })).toBeChecked({ timeout: 30_000 });

  // Off withdraws it straight away.
  await page.getByRole("checkbox", { name: "Let Ask see my chart screenshots" }).click();
  await expect.poll(consentRows).toEqual([]);

  // Groq's models are text-only: no switch at all.
  await pickKey(page, "Groq");
  await expect(page.getByRole("checkbox", { name: "Let Ask see my chart screenshots" })).toHaveCount(0);
});
