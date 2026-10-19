import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * The suggested-change card in Ask (2026-10-17). There is no real provider
 * key here, so the turn's stream is faked at the browser boundary, carrying
 * a `proposal` event exactly as runTurn emits it; Apply / Dismiss are faked
 * the same way. What this pins is the card: it shows the server's diff, its
 * buttons send no content, and it reports the outcome. The last test uses
 * no fakes at all: a stored proposal (0070), the real Apply route, and the
 * trade read back from the database.
 */

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let user: TestUser;

test.beforeAll(async () => {
  user = await createTestUser();
  const plan = await admin.from("user_settings").update({ plan: "paid" }).eq("user_id", user.id);
  if (plan.error) throw plan.error;
  const key = await admin
    .from("user_api_keys")
    .insert({ user_id: user.id, provider: "openai", encrypted_key: "test-not-a-real-key", last_four: "TEST", is_active: true, model: "gpt-5-mini" });
  if (key.error) throw key.error;
  const consent = await admin.from("ai_provider_consents").insert({ user_id: user.id, provider: "openai", scope: "chat_v2" });
  if (consent.error) throw consent.error;
});

test.afterAll(async () => {
  await deleteTestUser(user.id);
});

const card = (id: string, title: string) => ({
  id,
  toolCallId: `call-${id}`,
  kind: "fill_field",
  status: "pending",
  display: {
    title,
    changes: [{ label: "Stop Loss", before: "empty", after: "176.5" }],
    note: "Figures that depend on it (risk, R multiple, P&L) are recalculated, as when you type it on the trade page.",
    href: "/trades",
  },
  outcome: null,
});

function fakeTurn(page: Page) {
  return page.route("**/api/chat/conversations/*/turn", (route) => {
    const events = [
      { type: "tool_result", toolCallId: "call-p1", name: "propose_change", ok: true, summary: "done" },
      { type: "proposal", proposal: card("p1", "Fill in Stop Loss on AAPL (3 Oct 2026)") },
      { type: "tool_result", toolCallId: "call-p2", name: "propose_change", ok: true, summary: "done" },
      { type: "proposal", proposal: card("p2", "Fill in Stop Loss on TSLA (4 Oct 2026)") },
      { type: "message_start", messageId: "m1" },
      { type: "text_delta", messageId: "m1", text: "I've suggested stops for both trades." },
      { type: "message_end", messageId: "m1", stopReason: "text" },
      { type: "done", next: "idle", round: 1 },
    ];
    return route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    });
  });
}

test("a suggested change shows its diff, applies on a click with no content, and can be dismissed", async ({ page }) => {
  await fakeTurn(page);
  const bodies: (string | null)[] = [];
  await page.route("**/api/chat/proposals/*/*", (route) => {
    const [, id, action] = new URL(route.request().url()).pathname.match(/proposals\/([^/]+)\/(apply|dismiss)/) ?? [];
    bodies.push(route.request().postData());
    const status = action === "apply" ? "applied" : "dismissed";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ proposal: { ...card(id, id === "p1" ? "Fill in Stop Loss on AAPL (3 Oct 2026)" : "Fill in Stop Loss on TSLA (4 Oct 2026)"), status } }),
    });
  });

  await signIn(page, user);
  await page.getByRole("button", { name: /no thanks, start empty/i }).click({ timeout: 15_000 }).catch(() => {});
  await page.getByRole("button", { name: /explore on my own/i }).click({ timeout: 10_000 }).catch(() => {});
  await page.goto("/ask");

  await page.getByPlaceholder(/Ask anything/).fill("Add the missing stops on my last two trades");
  await page.getByRole("button", { name: "Ask", exact: true }).click();

  const cards = page.getByTestId("proposal-card");
  await expect(cards).toHaveCount(2, { timeout: 30_000 });
  const first = cards.nth(0);
  await expect(first).toContainText("Fill in Stop Loss on AAPL (3 Oct 2026)");
  await expect(first).toContainText("176.5");
  await expect(first).toContainText("Nothing changes unless you press Apply.");

  await first.getByRole("button", { name: "Apply" }).click();
  await expect(first.getByRole("status")).toContainText("Applied");
  await expect(first.getByRole("link", { name: "See it" })).toHaveAttribute("href", "/trades");

  const second = cards.nth(1);
  await second.getByRole("button", { name: "Dismiss" }).click();
  await expect(second.getByRole("status")).toContainText("Dismissed");

  // The click names a proposal; it never carries the change itself.
  expect(bodies).toEqual([null, null]);
});

test("the card fits a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await fakeTurn(page);
  await signIn(page, user);
  await page.getByRole("button", { name: /no thanks, start empty/i }).click({ timeout: 15_000 }).catch(() => {});
  await page.getByRole("button", { name: /explore on my own/i }).click({ timeout: 10_000 }).catch(() => {});
  await page.goto("/ask");
  await page.getByPlaceholder(/Ask anything/).fill("Add the missing stop");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const first = page.getByTestId("proposal-card").first();
  await expect(first).toBeVisible({ timeout: 30_000 });
  const box = await first.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await first.screenshot({ path: "test-results/proposal-card-phone.png" });
});

test("Apply on a saved conversation's card really changes the trade (real route, real database)", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, user);
  await page.getByRole("button", { name: /no thanks, start empty/i }).click({ timeout: 15_000 }).catch(() => {});
  await page.getByRole("button", { name: /explore on my own/i }).click({ timeout: 10_000 }).catch(() => {});

  // A trade with no take profit, made through the app's own API.
  const { id: tradeId } = (await (await page.request.post("/api/trades")).json()) as { id: string };
  const named = await page.request.patch(`/api/trades/${tradeId}`, { data: { core: { ticker: "AAPL" } } });
  expect(named.ok()).toBe(true);

  // A conversation in which Ask suggested filling it, as runTurn stores one.
  const { data: key } = await admin.from("user_api_keys").select("id").eq("user_id", user.id).single();
  const conv = await admin
    .from("ai_conversations")
    .insert({ user_id: user.id, provider: "openai", model: "gpt-5-mini", key_id: key!.id, title: "Fill my target", message_count: 4 })
    .select("id")
    .single();
  if (conv.error) throw conv.error;
  const conversationId = conv.data.id as string;
  const call = { id: "call-real-1", name: "propose_change", args: { kind: "fill_field" } };
  const msgs = await admin.from("ai_messages").insert([
    { user_id: user.id, conversation_id: conversationId, seq: 0, role: "user", content: "Set a 150 target on my AAPL trade" },
    { user_id: user.id, conversation_id: conversationId, seq: 1, role: "assistant", content: "", tool_calls: [call] },
    { user_id: user.id, conversation_id: conversationId, seq: 2, role: "tool", content: '{"proposed":true}', tool_call_id: call.id, tool_name: call.name },
    { user_id: user.id, conversation_id: conversationId, seq: 3, role: "assistant", content: "I've suggested it: press Apply to save." },
  ]);
  if (msgs.error) throw msgs.error;
  const proposal = await admin
    .from("ai_proposals")
    .insert({
      user_id: user.id,
      conversation_id: conversationId,
      tool_call_id: call.id,
      kind: "fill_field",
      trade_id: tradeId,
      payload: { field: "take_profit", value: 150 },
      before: { core: { take_profit: null } },
      display: { title: "Fill in Take Profit on AAPL", changes: [{ label: "Take Profit", before: "empty", after: "150" }], href: `/trades/${tradeId}` },
    })
    .select("id")
    .single();
  if (proposal.error) throw proposal.error;

  // Server-rendered on load: the card comes from ai_proposals, not the stream.
  await page.goto(`/ask?c=${conversationId}`);
  const cardEl = page.getByTestId("proposal-card");
  await expect(cardEl).toContainText("Fill in Take Profit on AAPL", { timeout: 30_000 });
  const before = await admin.from("trades").select("take_profit").eq("id", tradeId).single();
  expect(before.data!.take_profit).toBeNull();

  await cardEl.getByRole("button", { name: "Apply" }).click();
  await expect(cardEl.getByRole("status")).toContainText("Applied");
  const after = await admin.from("trades").select("take_profit").eq("id", tradeId).single();
  expect(Number(after.data!.take_profit)).toBe(150);
  const stored = await admin.from("ai_proposals").select("status").eq("id", proposal.data.id).single();
  expect(stored.data!.status).toBe("applied");

  // Reloaded, it stays applied -- no second Apply on offer.
  await page.reload();
  await expect(page.getByTestId("proposal-card").getByRole("status")).toContainText("Applied", { timeout: 30_000 });
  await expect(page.getByTestId("proposal-card").getByRole("button", { name: "Apply" })).toHaveCount(0);
});
