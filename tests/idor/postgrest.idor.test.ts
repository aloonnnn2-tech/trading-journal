/**
 * User A, holding only their own session token, goes straight at PostgREST
 * and Storage -- the routes are not involved. This is the attacker the 2026-09-21
 * review used: anyone signed in holds the anon key plus their JWT, and can
 * call the database API directly.
 *
 * Proves, for every user-data table: A cannot read, change or delete B's
 * rows, cannot write a row as B, and cannot write a row of their own that
 * points at B's records (foreign keys bypass RLS -- migration 0059).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, createWorld, destroyWorld, IMAGE_BUCKET, snapshot, TINY_PNG, type TestUser } from "./world";

let A: TestUser;
let B: TestUser;

beforeAll(async () => {
  ({ A, B } = await createWorld());
});

afterAll(async () => {
  await destroyWorld(A, B);
});

// table -> how to find B's row in it
const OWNED: [table: string, key: string, id: (u: TestUser) => string][] = [
  ["trades", "id", (u) => u.journal.tradeId],
  ["trade_history", "id", (u) => u.journal.historyId],
  ["trade_images", "id", (u) => u.journal.imageId],
  ["folders", "id", (u) => u.journal.folderId],
  ["trade_folders", "folder_id", (u) => u.journal.folderId],
  ["strategies", "id", (u) => u.journal.strategyId],
  ["trade_strategies", "strategy_id", (u) => u.journal.strategyId],
  ["strategy_rules", "id", (u) => u.journal.ruleId],
  ["field_definitions", "id", (u) => u.journal.fieldId],
  ["commission_rules", "id", (u) => u.journal.commissionRuleId],
  ["goals", "id", (u) => u.journal.goalId],
  ["account_transactions", "id", (u) => u.journal.transactionId],
  ["monthly_costs", "id", (u) => u.journal.monthlyCostId],
  ["ai_conversations", "id", (u) => u.journal.conversationId],
  ["ai_messages", "conversation_id", (u) => u.journal.conversationId],
  ["ai_reviews", "id", (u) => u.journal.reviewId],
  ["trade_excursions", "trade_id", (u) => u.journal.tradeId],
  ["user_settings", "user_id", (u) => u.id],
];

describe("A cannot reach B's rows through PostgREST", () => {
  it.each(OWNED)("%s: read returns nothing", async (table, key, id) => {
    const { data, error } = await A.db.from(table).select("*").eq(key, id(B));
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it.each(OWNED)("%s: update changes nothing", async (table, key, id) => {
    const before = await snapshot(table, key, id(B));
    expect(before.length).toBeGreaterThan(0);
    // updated_at exists on most tables; for the rest PostgREST rejects the
    // unknown column, which is also "changed nothing" -- the snapshot decides.
    await A.db.from(table).update({ updated_at: new Date(0).toISOString() }).eq(key, id(B));
    expect(await snapshot(table, key, id(B))).toEqual(before);
  });

  it.each(OWNED)("%s: delete removes nothing", async (table, key, id) => {
    const before = await snapshot(table, key, id(B));
    await A.db.from(table).delete().eq(key, id(B));
    expect(await snapshot(table, key, id(B))).toEqual(before);
  });

  it("user_api_keys: A sees only its own key's public columns, never ciphertext, never B's key (0058)", async () => {
    const own = await A.db.from("user_api_keys").select("id, last_four").eq("id", A.journal.keyId);
    expect(own.data).toEqual([{ id: A.journal.keyId, last_four: "abcd" }]);
    const cipher = await A.db.from("user_api_keys").select("encrypted_key").eq("id", A.journal.keyId);
    expect(cipher.error?.code).toBe("42501");
    const theirs = await A.db.from("user_api_keys").select("id, last_four").eq("id", B.journal.keyId);
    expect(theirs.data ?? []).toEqual([]);
    const insert = await A.db
      .from("user_api_keys")
      .insert({ user_id: A.id, provider: "openai", encrypted_key: "x", last_four: "zzzz" });
    expect(insert.error?.code).toBe("42501");
  });

  it("cannot insert a row owned by B", async () => {
    const { error } = await A.db.from("trades").insert({ user_id: B.id, ticker: "X" });
    expect(error?.code).toBe("42501");
  });

  it("cannot make itself paid or admin", async () => {
    const plan = await A.db.from("user_settings").update({ plan: "paid" }).eq("user_id", A.id);
    const adm = await A.db.from("user_settings").update({ is_admin: true }).eq("user_id", A.id);
    expect(plan.error?.code).toBe("42501");
    expect(adm.error?.code).toBe("42501");
  });

  it("cannot read service-only tables or analytics", async () => {
    for (const table of ["waitlist", "rate_limit_counters", "schema_migrations", "analytics_events", "analytics_sessions"]) {
      const { data } = await A.db.from(table).select("*").limit(1);
      expect(data ?? [], table).toEqual([]);
    }
  });

  it("cannot call admin RPCs", async () => {
    const { data, error } = await A.db.rpc("admin_user_detail", { p_user_id: B.id, p_days: 30 });
    expect(error ?? data).toBeTruthy();
    expect(JSON.stringify(data ?? "")).not.toContain(B.journal.marker);
  });
});

describe("A cannot point its own rows at B's records (0059)", () => {
  const cases: [label: string, table: string, row: () => Record<string, unknown>][] = [
    ["history on B's trade", "trade_history", () => ({ trade_id: B.journal.tradeId, snapshot: {} })],
    ["image on B's trade", "trade_images", () => ({ trade_id: B.journal.tradeId, storage_path: `${A.id}/x.png` })],
    [
      "review of B's trade",
      "ai_reviews",
      () => ({
        review_type: "trade",
        trade_id: B.journal.tradeId,
        trades_analyzed: 1,
        provider: "openai",
        model: "m",
        content: {},
      }),
    ],
    ["excursion on B's trade", "trade_excursions", () => ({ trade_id: B.journal.tradeId, symbol: "X", status: "ok" })],
    [
      "rule on B's strategy",
      "strategy_rules",
      () => ({ strategy_id: B.journal.strategyId, label: "x", subject_source: "core", subject_key: "shares", operator: "is_set" }),
    ],
    [
      "field on B's strategy",
      "field_definitions",
      () => ({ strategy_id: B.journal.strategyId, entity_type: "trade", key: "x_idor", label: "x", field_type: "text" }),
    ],
    ["conversation on B's key", "ai_conversations", () => ({ provider: "openai", model: "m", key_id: B.journal.keyId })],
    ["posting on B's monthly cost", "monthly_cost_postings", () => ({ cost_id: B.journal.monthlyCostId, month: "2026-01-01" })],
    ["link B's trade into A's folder", "trade_folders", () => ({ trade_id: B.journal.tradeId, folder_id: A.journal.folderId })],
    ["link A's trade into B's folder", "trade_folders", () => ({ trade_id: A.journal.tradeId, folder_id: B.journal.folderId })],
    [
      "link A's trade to B's strategy",
      "trade_strategies",
      () => ({ trade_id: A.journal.tradeId, strategy_id: B.journal.strategyId }),
    ],
    [
      "message into B's conversation",
      "ai_messages",
      () => ({ conversation_id: B.journal.conversationId, seq: 99, role: "user", content: "x" }),
    ],
  ];

  it.each(cases)("%s is refused", async (_label, table, row) => {
    const withOwner = table === "trade_folders" || table === "trade_strategies" ? row() : { user_id: A.id, ...row() };
    const { error } = await A.db.from(table).insert(withOwner);
    expect(error, "insert should have been refused").not.toBeNull();
    expect(["42501", "23503"]).toContain(error!.code);
  });

  it("the posting case on A's own cost works (the check is not just refusing everything)", async () => {
    const { error } = await A.db
      .from("monthly_cost_postings")
      .insert({ user_id: A.id, cost_id: A.journal.monthlyCostId, month: "2026-01-01" });
    expect(error).toBeNull();
  });

  it("A cannot repoint its own trade at B's fee", async () => {
    const { error } = await A.db
      .from("trades")
      .update({ commission_rule_id: B.journal.commissionRuleId })
      .eq("id", A.journal.tradeId);
    expect(error).not.toBeNull();
  });
});

describe("Storage: trade-images is private per user", () => {
  it("A cannot download B's file", async () => {
    const { data, error } = await A.db.storage.from(IMAGE_BUCKET).download(B.journal.imagePath);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("A cannot list B's folder", async () => {
    const { data } = await A.db.storage.from(IMAGE_BUCKET).list(`${B.id}/${B.journal.tradeId}`);
    expect(data ?? []).toEqual([]);
  });

  it("A cannot sign a URL for B's file", async () => {
    const { data } = await A.db.storage.from(IMAGE_BUCKET).createSignedUrl(B.journal.imagePath, 60);
    expect(data?.signedUrl ?? null).toBeNull();
  });

  it("A cannot upload into B's folder, or overwrite or delete B's file", async () => {
    const up = await A.db.storage.from(IMAGE_BUCKET).upload(`${B.id}/${B.journal.tradeId}/evil.png`, TINY_PNG, {
      contentType: "image/png",
    });
    expect(up.error).not.toBeNull();
    const over = await A.db.storage.from(IMAGE_BUCKET).update(B.journal.imagePath, TINY_PNG, { contentType: "image/png" });
    expect(over.error).not.toBeNull();
    await A.db.storage.from(IMAGE_BUCKET).remove([B.journal.imagePath]);
    const stillThere = await B.db.storage.from(IMAGE_BUCKET).download(B.journal.imagePath);
    expect(stillThere.error).toBeNull();
  });

  it("A can download its own file (the policy is not just refusing everything)", async () => {
    const { error } = await A.db.storage.from(IMAGE_BUCKET).download(A.journal.imagePath);
    expect(error).toBeNull();
  });
});

// ---- Security gaps pass, Phase 2 (migration 0073) ---------------------------

describe("service-role-only functions (G-1)", () => {
  it("a signed-in user cannot call rate_limit_hit -- it would let anyone exhaust a shared limit", async () => {
    const { error } = await A.db.rpc("rate_limit_hit", { p_bucket: "upstream:yahoo", p_max: 1, p_window_seconds: 60 });
    expect(error).not.toBeNull();
  });

  it("nobody without a session can call it either", async () => {
    const anon = anonClient();
    const { error } = await anon.rpc("rate_limit_hit", { p_bucket: "upstream:yahoo", p_max: 1, p_window_seconds: 60 });
    expect(error).not.toBeNull();
  });

  it("a signed-in user cannot call prune_click_events (it deletes analytics)", async () => {
    // p_days far in the future would delete nothing even if it ran.
    const { error } = await A.db.rpc("prune_click_events", { p_days: 100000 });
    expect(error).not.toBeNull();
  });
});

describe("no direct uploads (G-2)", () => {
  it("A cannot upload even into A's OWN folder: uploads go through the app, which checks and re-encodes them", async () => {
    const up = await A.db.storage
      .from(IMAGE_BUCKET)
      .upload(`${A.id}/${A.journal.tradeId}/direct.png`, TINY_PNG, { contentType: "image/png" });
    expect(up.error).not.toBeNull();
  });

  it("A can still read A's own files", async () => {
    const { error } = await A.db.storage.from(IMAGE_BUCKET).download(A.journal.imagePath);
    expect(error).toBeNull();
  });
});
