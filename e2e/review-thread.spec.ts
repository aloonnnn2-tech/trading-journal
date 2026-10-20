import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * Debating a trade review (0071; Alon, 2026-10-17). There is no real provider
 * key here, so the reply route is faked at the browser boundary with what it
 * returns when the AI is convinced: the exchange, both versions and the
 * revised review. What this pins is the panel: the thread shows the verdict,
 * the review switches to the new version, and the original stays one tap away.
 * (The route's logic is unit-tested in src/lib/ai-reviews/thread.test.ts.)
 */

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const content = (score: number, assessment: string) => ({
  overall_assessment: assessment,
  score,
  score_breakdown: { exit_management: score },
  what_went_well: ["Stop placed below the breakout level"],
  what_could_improve: ["Exited 1.4R before the 3R target"],
  biggest_mistake: "",
  best_decision: "",
  rule_adherence: [],
  emotional_analysis: [],
  action_items: ["Hold to target unless a stated rule says otherwise"],
  missing_information: [],
});

let user: TestUser;
let reviewId: string;
let tradeId: string;

test.beforeAll(async () => {
  user = await createTestUser();
  await admin.from("user_settings").update({ plan: "paid" }).eq("user_id", user.id);
  await admin
    .from("user_api_keys")
    .insert({ user_id: user.id, provider: "openai", encrypted_key: "test-not-a-real-key", last_four: "TEST", is_active: true, model: "gpt-5-mini" });
  await admin.from("ai_provider_consents").insert({ user_id: user.id, provider: "openai", scope: "journal_v1" });
});

test.afterAll(async () => {
  await deleteTestUser(user.id);
});

test("explaining a decision can change the review, and the original stays one tap away", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, user);
  await page.getByRole("button", { name: /no thanks, start empty/i }).click({ timeout: 10_000 }).catch(() => {});
  await page.getByRole("button", { name: /explore on my own/i }).click({ timeout: 10_000 }).catch(() => {});

  tradeId = ((await (await page.request.post("/api/trades")).json()) as { id: string }).id;
  await page.request.patch(`/api/trades/${tradeId}`, {
    data: { core: { ticker: "ZZQX", direction: "long", status: "closed", entry_price: 10, exit_price: 11, shares: 1 } },
  });
  const inserted = await admin
    .from("ai_reviews")
    .insert({
      user_id: user.id,
      review_type: "trade",
      trade_id: tradeId,
      trades_analyzed: 1,
      provider: "openai",
      model: "gpt-5-mini",
      content: content(55, "Good entry, exit too early."),
    })
    .select("id, created_at")
    .single();
  if (inserted.error) throw inserted.error;
  reviewId = inserted.data.id;

  let sent: { keyId?: string; message?: string } | null = null;
  await page.route(`**/api/ai-reviews/${reviewId}/reply`, async (route) => {
    sent = route.request().postDataJSON();
    const now = new Date().toISOString();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        messages: [
          { id: "m1", seq: 0, role: "user", content: sent!.message, verdict: null, version_after: null, created_at: now },
          {
            id: "m2",
            seq: 1,
            role: "assistant",
            content: "That's a stated rule and you followed it, so the early exit was the plan, not a mistake.",
            verdict: "convinced",
            version_after: 2,
            created_at: now,
          },
        ],
        versions: [
          { version: 1, content: content(55, "Good entry, exit too early."), provider: "openai", model: "gpt-5-mini", changed_because: null, created_at: inserted.data.created_at },
          { version: 2, content: content(78, "Good entry, exit by the plan."), provider: "openai", model: "gpt-5-mini", changed_because: "The exit followed the trader's earnings rule.", created_at: now },
        ],
        review: { content: content(78, "Good entry, exit by the plan."), provider: "openai", model: "gpt-5-mini" },
      }),
    });
  });

  await page.goto(`/trades/${tradeId}`);
  await expect(page.getByText("Good entry, exit too early.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Explain a decision or push back")).toBeVisible();

  await page.getByPlaceholder("Why did you do it that way?").fill("I always exit before earnings. It's in my rules.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText(/You convinced it · review updated to version 2/)).toBeVisible();
  await expect(page.getByText("Good entry, exit by the plan.")).toBeVisible();
  await expect(page.getByText("Version 2 of 2 (current)")).toBeVisible();
  await expect(page.getByText("Changed because: The exit followed the trader's earnings rule.")).toBeVisible();
  expect(sent).toMatchObject({ message: "I always exit before earnings. It's in my rules." });

  await page.getByRole("button", { name: "v1" }).click();
  await expect(page.getByText("Good entry, exit too early.")).toBeVisible();
  await expect(page.getByText("The original review, before the discussion below.")).toBeVisible();
});
